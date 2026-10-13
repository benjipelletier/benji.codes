import { ChongfuxiApp } from "@chongfuxi/components/ChongfuxiApp";

// Everything lives in the browser for now (see chongfuxi/lib/store.ts), so the
// page is a client app with nothing to render on the server.
export default function ChongfuxiPage() {
  return <ChongfuxiApp />;
}
