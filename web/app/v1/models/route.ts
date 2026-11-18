import { forwardGateway } from "@/lib/gateway-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return forwardGateway(request, "/v1/models");
}
