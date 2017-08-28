import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { Icon } from '../Icons'
import { Text } from '../Text'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  background: rgba(${props => props.color}, .1);
  border: 1px solid rgba(${props => props.color}, .2);
  border-radius: 4px;
  padding: 5px 10px;
  -moz-osx-font-smoothing: grayscale;
  -webkit-font-smoothing: antialiased;

  & > :first-child { margin-right: 8px; }
`

const selectStyle = type => {
  switch (type) {
    case 'success': return { color1: 'jade', color2: '0, 167, 111', uppercase: false, icon: 'success' }
    case 'warning': return { color1: 'mahogany', color2: '202, 58, 60', uppercase: true, icon: 'alert' }
    case 'alert': return { color1: 'iris', color2: '16, 173, 228', uppercase: false, icon: 'bell' }
    default: return { color1: 'iris', color2: '16, 173, 228', uppercase: false, icon: null }
  }
}

const Banner = props => {
  const { type, children } = props
  const style = selectStyle(type)
  const { color1, color2, uppercase, icon } = style

  return (
    <Container color={color2}>
      { icon && <Icon name={icon} size='12px' weight={400} color={color1} /> }
      <Text size='12px' weight={400} color={color1} uppercase={uppercase}>
        { children }
      </Text>
    </Container>
  )
}

Banner.propTypes = {
  children: PropTypes.element.isRequired,
  type: PropTypes.oneOf(['success', 'warning', 'alert'])
}

export default Banner
