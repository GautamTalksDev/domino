// The workspace's shape, shown instantly while the analysis runs on FalkorDB.
export default function Loading() {
  return (
    <div className="pt-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the patient’s graph</span>
      <div className="skeleton h-3 w-36" />
      <div className="skeleton mt-5 h-12 w-72" />
      <div className="skeleton mt-4 h-4 w-96 max-w-full" />
      <div className="skeleton mt-3 h-5 w-80 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card h-[88px] p-4">
            <div className="skeleton h-6 w-10" />
            <div className="skeleton mt-3 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <div className="flex gap-6 border-b hairline pb-3">
            {['w-16', 'w-14', 'w-10', 'w-10', 'w-14'].map((w, i) => (
              <div key={i} className={`skeleton h-4 ${w}`} />
            ))}
          </div>
          <div className="card mt-6 p-6">
            <div className="skeleton h-3 w-44" />
            <div className="skeleton mt-3 h-7 w-64" />
            <div className="mt-8 flex flex-wrap items-center gap-5">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-5">
                  <div className="skeleton h-[118px] w-[84px] !rounded-[11px]" style={{ animationDelay: `${i * 0.12}s` }} />
                  {i < 3 && <div className="skeleton h-[2px] w-16" />}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card h-[420px] p-5">
          <div className="flex items-center justify-between">
            <div className="skeleton h-4 w-28" />
            <div className="skeleton h-9 w-28 !rounded-xl" />
          </div>
          <div className="skeleton mt-8 h-3 w-full" />
          <div className="skeleton mt-2 h-3 w-5/6" />
          <div className="skeleton mt-2 h-3 w-4/6" />
        </div>
      </div>
    </div>
  );
}
