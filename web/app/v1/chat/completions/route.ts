import { forwardGateway } from "@/lib/gateway-proxy";

export function POST(request: Request) {
  return forwardGateway(request, "/v1/chat/completions");
}
