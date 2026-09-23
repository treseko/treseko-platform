import { useState, type ComponentProps } from 'react'
import { Button, Form, InputGroup } from 'react-bootstrap'
import { Eye, EyeOff } from 'lucide-react'

type PasswordVisibilityFieldProps = Omit<ComponentProps<typeof Form.Control>, 'type'> & {
  showLabel: string
  hideLabel: string
}

export function PasswordVisibilityField({ showLabel, hideLabel, ...inputProps }: PasswordVisibilityFieldProps) {
  const [visible, setVisible] = useState(false)
  const label = visible ? hideLabel : showLabel

  return (
    <InputGroup>
      <Form.Control {...inputProps} type={visible ? 'text' : 'password'} />
      <Button
        type="button"
        variant="outline-secondary"
        aria-label={label}
        aria-pressed={visible}
        title={label}
        onClick={() => setVisible(current => !current)}
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </Button>
    </InputGroup>
  )
}
