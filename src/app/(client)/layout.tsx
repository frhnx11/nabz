import { SiteHeader } from "@/components/shell/site-header";

export default function ClientLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader area="client" />
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 px-4 py-8 sm:px-6">
        {children}
      </main>
    </>
  );
}
