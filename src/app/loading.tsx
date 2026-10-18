// Shown instantly while a page's graph queries run on the server.
export default function Loading() {
  return (
    <div className="pt-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="skeleton h-3 w-40" />
      <div className="skeleton mt-5 h-12 w-[min(520px,80%)]" />
      <div className="skeleton mt-4 h-4 w-[min(640px,90%)]" />
      <div className="skeleton mt-2 h-4 w-[min(560px,75%)]" />
      <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card h-24 p-4">
            <div className="skeleton h-6 w-16" />
            <div className="skeleton mt-3 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="card h-[420px] p-6">
          <div className="skeleton h-4 w-48" />
          <div className="mt-8 flex gap-6">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton h-[118px] w-[84px] !rounded-[11px]" style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
        </div>
        <div className="card h-[420px] p-6">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton mt-6 h-3 w-full" />
          <div className="skeleton mt-2 h-3 w-5/6" />
          <div className="skeleton mt-2 h-3 w-4/6" />
        </div>
      </div>
    </div>
  );
}
