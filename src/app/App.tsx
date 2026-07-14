import FeatureCard from '../components/FeatureCard'

const FEATURES = [
  { title: '위험물 Class 안내', status: '준비 중' },
  { title: 'UN번호 조회', status: '준비 중' },
  { title: '격리·혼적 판정', status: '준비 중' },
]

function App() {
  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-header__title">HazCargo Mobile</h1>
        <p className="app-header__subtitle">Maritime Dangerous Goods Reference</p>
        <p className="app-header__codename">&ldquo;HazCargo Mobile&rdquo;은 개발 코드명입니다.</p>
      </header>

      <section aria-label="주요 기능" className="feature-list">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} title={feature.title} status={feature.status} />
        ))}
      </section>

      <section className="disclaimer" aria-label="면책 안내">
        <p>본 앱은 위험물 검토를 지원하기 위한 참고 도구로 개발 중입니다.</p>
        <p>실제 선적 시에는 적용되는 공식 규정과 관계 기관 및 담당자의 최종 확인이 필요합니다.</p>
      </section>
    </main>
  )
}

export default App
