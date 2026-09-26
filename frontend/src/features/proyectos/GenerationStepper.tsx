type Props = {
  labels: string[]
  currentStep: number
  ariaLabel: string
}

export function GenerationStepper({ labels, currentStep, ariaLabel }: Props) {
  return (
    <ol
      className="list-unstyled d-flex flex-wrap gap-2 small mb-0"
      aria-label={ariaLabel}
    >
      {labels.map((label, index) => {
        const completed = index < currentStep
        const current = index === currentStep
        return (
          <li key={label}>
            <span
              className={`d-inline-flex align-items-center border rounded px-2 py-1 ${current ? "bg-primary text-white border-primary" : completed ? "bg-light text-muted" : "text-muted"}`}
              aria-current={current ? "step" : undefined}
            >
              <span className="me-1" aria-hidden="true">{index + 1}.</span>
              {label.replace(/^\d+\.\s*/, "")}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
