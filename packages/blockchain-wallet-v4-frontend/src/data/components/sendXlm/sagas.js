import { call, delay, put, select } from 'redux-saga/effects'
import { equals, includes, path, pathOr, prop, head } from 'ramda'
import * as A from './actions'
import * as S from './selectors'
import { FORM } from './model'
import { actions, model, selectors } from 'data'
import {
  initialize,
  change,
  touch,
  startSubmit,
  stopSubmit,
  destroy
} from 'redux-form'
import * as C from 'services/AlertService'
import * as Lockbox from 'services/LockboxService'
import { promptForSecondPassword, promptForLockbox } from 'services/SagaService'
import { Exchange } from 'blockchain-wallet-v4/src'
import { ADDRESS_TYPES } from 'blockchain-wallet-v4/src/redux/payment/btc/utils'

const { TRANSACTION_EVENTS } = model.analytics
export const logLocation = 'components/sendXlm/sagas'
export const INITIAL_MEMO_TYPE = 'text'
export default ({ api, coreSagas }) => {
  const initialized = function * (action) {
    try {
      const from = path(['payload', 'from'], action)
      const type = path(['payload', 'type'], action)
      yield put(A.paymentUpdatedLoading())
      yield put(actions.components.send.fetchPaymentsAccountPit('XLM'))
      let payment = coreSagas.payment.xlm.create()
      payment = yield call(payment.init)
      payment = yield call(payment.memoType, INITIAL_MEMO_TYPE)
      payment =
        from && type
          ? yield call(setFrom, payment, from, type)
          : yield call(setFrom, payment)
      const defaultFee = prop('fee', payment.value())
      const defaultAccount = (yield select(
        selectors.core.common.xlm.getAccountBalances
      ))
        .map(head)
        .getOrElse({})
      const initialValues = {
        coin: 'XLM',
        fee: defaultFee,
        from: defaultAccount,
        memoType: INITIAL_MEMO_TYPE
      }
      yield put(initialize(FORM, initialValues))
      yield put(touch(FORM, 'memo', 'memoType'))
      yield put(A.paymentUpdatedSuccess(payment.value()))
    } catch (e) {
      yield put(actions.logs.logErrorMessage(logLocation, 'initialized', e))
    }
  }

  const destroyed = function * () {
    yield put(actions.form.destroy(FORM))
  }

  const formChanged = function * (action) {
    try {
      const form = path(['meta', 'form'], action)
      if (!equals(FORM, form)) return
      const field = path(['meta', 'field'], action)
      const payload = prop('payload', action)
      const erc20List = (yield select(
        selectors.core.walletOptions.getErc20CoinList
      )).getOrElse([])
      let payment = (yield select(S.getPayment)).getOrElse({})
      payment = yield call(coreSagas.payment.xlm.create, { payment })

      switch (field) {
        case 'coin':
          const modalName = includes(payload, erc20List) ? 'ETH' : payload
          yield put(actions.modals.closeAllModals())
          yield put(
            actions.modals.showModal(`@MODAL.SEND.${modalName}`, {
              coin: payload
            })
          )
          break
        case 'from':
          const source = prop('address', payload)
          const fromType = prop('type', payload)
          payment = yield call(setFrom, payment, source, fromType)
          break
        case 'to':
          const value = pathOr({}, ['value', 'value'], payload)
          const splitValue = value.split(':')
          const address = splitValue[0]
          payment = yield payment.to(address)
          // Do not block payment update when to is changed w/ destinationAccount check
          yield put(A.paymentUpdatedSuccess(payment.value()))
          // check if destination exists
          yield put(A.sendXlmCheckDestinationAccountExists(address))
          // check if destination is an exchange
          yield put(A.sendXlmCheckIfDestinationIsExchange(address))
          // PIT address split on : is [address, memo]
          if (splitValue.length > 1) {
            const memo = splitValue[1]
            yield put(actions.form.change(FORM, 'memo', memo))
          }
          return
        case 'amount':
          const xlmAmount = prop('coin', payload)
          const stroopAmount = Exchange.convertXlmToXlm({
            value: xlmAmount,
            fromUnit: 'XLM',
            toUnit: 'STROOP'
          }).value
          payment = yield call(payment.amount, stroopAmount)
          break
        case 'description':
          payment = yield call(payment.description, payload)
          break
        case 'memo':
          payment = yield call(payment.memo, String(payload))
          break
        case 'memoType':
          payment = yield call(payment.memoType, payload)
          break
      }

      yield put(A.paymentUpdatedSuccess(payment.value()))
    } catch (e) {
      yield put(actions.logs.logErrorMessage(logLocation, 'formChanged', e))
    }
  }

  const checkAccountExistence = function * (id) {
    try {
      yield call(api.getXlmAccount, id)
      return true
    } catch (e) {
      return false
    }
  }

  const checkIfDestinationIsExchange = function * ({ payload }) {
    try {
      yield put(A.sendXlmCheckIfDestinationIsExchangeLoading())
      const exchangeAddresses = (yield select(
        selectors.core.walletOptions.getXlmExchangeAddresses
      )).getOrElse([])
      const isExchange = includes(payload, exchangeAddresses)
      yield put(A.sendXlmCheckIfDestinationIsExchangeSuccess(isExchange))
    } catch (e) {
      yield put(A.sendXlmCheckIfDestinationIsExchangeFailure(e))
    }
  }

  const checkDestinationAccountExists = function * ({ payload }) {
    try {
      yield put(A.sendXlmCheckDestinationAccountExistsLoading())
      const destinationAccountExists = yield call(
        checkAccountExistence,
        payload
      )

      let payment = (yield select(S.getPayment)).getOrElse({})
      payment = yield call(coreSagas.payment.xlm.create, { payment })
      payment = yield payment.setDestinationAccountExists(
        destinationAccountExists
      )

      yield put(A.paymentUpdatedSuccess(payment.value()))
      yield put(
        A.sendXlmCheckDestinationAccountExistsSuccess(destinationAccountExists)
      )
    } catch (e) {
      yield put(A.sendXlmCheckDestinationAccountExistsFailure(e))
    }
  }

  const maximumAmountClicked = function * () {
    try {
      const currency = (yield select(
        selectors.core.settings.getCurrency
      )).getOrFail('Can not retrieve currency.')
      const xlmRates = (yield select(
        selectors.core.data.xlm.getRates
      )).getOrFail('Can not retrieve stellar rates.')
      const payment = (yield select(S.getPayment)).getOrElse({})
      const effectiveBalance = prop('effectiveBalance', payment)
      const coin = Exchange.convertXlmToXlm({
        value: effectiveBalance,
        fromUnit: 'STROOP',
        toUnit: 'XLM'
      }).value
      const fiat = Exchange.convertXlmToFiat({
        value: effectiveBalance,
        fromUnit: 'STROOP',
        toCurrency: currency,
        rates: xlmRates
      }).value
      yield put(change(FORM, 'amount', { coin, fiat }))
    } catch (e) {
      yield put(
        actions.logs.logErrorMessage(logLocation, 'maximumAmountClicked', e)
      )
    }
  }

  const firstStepSubmitClicked = function * () {
    try {
      let payment = (yield select(S.getPayment)).getOrElse({})
      yield put(A.paymentUpdatedLoading())
      payment = yield call(coreSagas.payment.xlm.create, { payment })
      payment = yield call(payment.build)
      yield put(A.paymentUpdatedSuccess(payment.value()))
    } catch (e) {
      yield put(A.paymentUpdatedFailure(e))
      yield put(
        actions.logs.logErrorMessage(logLocation, 'firstStepSubmitClicked', e)
      )
    }
  }

  const secondStepSubmitClicked = function * () {
    yield put(startSubmit(FORM))
    let payment = (yield select(S.getPayment)).getOrElse({})
    payment = yield call(coreSagas.payment.xlm.create, { payment })
    const fromType = path(['from', 'type'], payment.value())
    const toAddress = path(['to', 'address'], payment.value())
    const fromAddress = path(['from', 'address'], payment.value())
    try {
      // Sign payment
      if (fromType !== ADDRESS_TYPES.LOCKBOX) {
        let password = yield call(promptForSecondPassword)
        payment = yield call(payment.sign, password)
      } else {
        const device = (yield select(
          selectors.core.kvStore.lockbox.getDeviceFromXlmAddr,
          fromAddress
        )).getOrFail('missing_device')
        const deviceType = prop('device_type', device)
        yield call(promptForLockbox, 'XLM', deviceType, [toAddress])
        let connection = yield select(
          selectors.components.lockbox.getCurrentConnection
        )
        const transport = prop('transport', connection)
        const scrambleKey = Lockbox.utils.getScrambleKey('XLM', deviceType)
        payment = yield call(payment.sign, null, transport, scrambleKey)
      }
      // Publish payment
      payment = yield call(payment.publish)
      yield put(actions.core.data.xlm.fetchData())
      const paymentValue = payment.value()
      yield put(A.paymentUpdatedSuccess(paymentValue))
      const description = paymentValue.description
      if (description)
        yield put(
          actions.core.kvStore.xlm.setTxNotesXlm(paymentValue.txId, description)
        )
      // Display success
      if (fromType === ADDRESS_TYPES.LOCKBOX) {
        yield put(actions.components.lockbox.setConnectionSuccess())
        yield delay(4000)
        const device = (yield select(
          selectors.core.kvStore.lockbox.getDeviceFromXlmAddr,
          fromAddress
        )).getOrFail('missing_device')
        const deviceIndex = prop('device_index', device)
        yield put(actions.router.push(`/lockbox/dashboard/${deviceIndex}`))
      } else {
        yield put(actions.router.push('/xlm/transactions'))
        yield put(
          actions.alerts.displaySuccess(C.SEND_COIN_SUCCESS, {
            coinName: 'Stellar'
          })
        )
      }
      yield put(destroy(FORM))
      yield put(
        actions.analytics.logEvent([
          ...TRANSACTION_EVENTS.SEND,
          'XLM',
          Exchange.convertCoinToCoin({
            value: payment.value().amount,
            coin: 'XLM',
            baseToStandard: true
          }).value
        ])
      )
      yield put(actions.modals.closeAllModals())
    } catch (e) {
      yield put(stopSubmit(FORM))
      // Set errors
      if (fromType === ADDRESS_TYPES.LOCKBOX) {
        yield put(actions.components.lockbox.setConnectionError(e))
      } else {
        yield put(
          actions.logs.logErrorMessage(
            logLocation,
            'secondStepSubmitClicked',
            e
          )
        )
        yield put(
          actions.analytics.logEvent([
            ...TRANSACTION_EVENTS.SEND_FAILURE,
            'XLM',
            e
          ])
        )
        yield put(
          actions.alerts.displayError(C.SEND_COIN_ERROR, {
            coinName: 'Stellar'
          })
        )
      }
    }
  }

  const setFrom = function * (payment, from, type) {
    try {
      const updatedPayment = yield call(payment.from, from, type)
      yield put(A.showNoAccountForm(false))
      return updatedPayment
    } catch (e) {
      const message = prop('message', e)
      if (message === 'Account does not exist') {
        yield put(A.showNoAccountForm(true))
        return payment
      }
      throw e
    }
  }

  return {
    initialized,
    checkDestinationAccountExists,
    checkIfDestinationIsExchange,
    destroyed,
    firstStepSubmitClicked,
    maximumAmountClicked,
    secondStepSubmitClicked,
    formChanged,
    setFrom
  }
}
