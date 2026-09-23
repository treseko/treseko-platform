import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PasswordVisibilityField } from './PasswordVisibilityField'

describe('PasswordVisibilityField', () => {
  it('starts hidden and toggles visibility with an accessible control', () => {
    render(<PasswordVisibilityField aria-label="Password" showLabel="Show password" hideLabel="Hide password" />)

    const input = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })

    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
  })
})
