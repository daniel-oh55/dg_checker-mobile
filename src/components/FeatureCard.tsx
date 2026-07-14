type FeatureCardProps = {
  title: string
  status: string
}

function FeatureCard({ title, status }: FeatureCardProps) {
  return (
    <button type="button" className="feature-card" aria-label={`${title}, ${status}`}>
      <span className="feature-card__title">{title}</span>
      <span className="feature-card__status">{status}</span>
    </button>
  )
}

export default FeatureCard
