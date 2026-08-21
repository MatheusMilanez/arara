// Placeholder do ARARA-702 (setup) — a Home de verdade (seção 9 do
// docs/design/VISUAL_IDENTITY.md) é o ARARA-710. Isto só confirma que os
// tokens de design (arara-blue) e a fonte Inter estão aplicando corretamente.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-arara-bg font-sans text-arara-text">
      <h1 className="text-3xl font-semibold text-arara-blue">ARARA</h1>
      <p className="text-arara-text-secondary">
        Setup do frontend (ARARA-702) — Home real vem no ARARA-710.
      </p>
    </main>
  );
}
