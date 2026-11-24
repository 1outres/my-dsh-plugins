const COLUMNS: readonly (readonly string[])[] = [
  ["tb-skeleton-medium", "tb-skeleton-tall", "tb-skeleton-short"],
  ["tb-skeleton-tall", "tb-skeleton-medium"],
  ["tb-skeleton-medium"],
]

export function BoardSkeleton() {
  return (
    <div className="tb-board" aria-busy="true">
      {COLUMNS.map((blocks, column) => (
        <div key={String(column)} className="tb-column" aria-hidden="true">
          <div className="tb-column-head">
            <span className="tb-skeleton tb-skeleton-head" />
          </div>
          <div className="tb-cards">
            {blocks.map((size, block) => (
              <span key={String(block)} className={`tb-skeleton tb-skeleton-card ${size}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
