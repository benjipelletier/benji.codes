import { ChongfuxiApp } from "@chongfuxi/components/ChongfuxiApp";

// Everything the page shows is asked of /api/chongfuxi once it knows the
// viewer's study day, so it is a client app with nothing to render on the server.
export default function ChongfuxiPage() {
  return <ChongfuxiApp />;
}
