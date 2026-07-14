import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'HazCargo Mobile' })).toBeInTheDocument()
  })

  it('renders all three feature cards', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /위험물 Class 안내/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /UN번호 조회/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /격리·혼적 판정/ })).toBeInTheDocument()
  })

  it('shows a "준비 중" status on every feature card', () => {
    render(<App />)
    const statuses = screen.getAllByText('준비 중')
    expect(statuses).toHaveLength(3)
  })

  it('renders the disclaimer notice', () => {
    render(<App />)
    expect(
      screen.getByText('본 앱은 위험물 검토를 지원하기 위한 참고 도구로 개발 중입니다.'),
    ).toBeInTheDocument()
  })
})
