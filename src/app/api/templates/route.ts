import { publicRead } from "@/lib/templates/http";
import { listCatalog } from "@/lib/templates/service";
export async function GET(request: Request) {
  const url = new URL(request.url);
  return publicRead(() =>
    listCatalog(url.searchParams.get("q"), url.searchParams.get("category")),
  );
}
