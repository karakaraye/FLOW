import { publicRead } from "@/lib/templates/http";
import { catalogDetail } from "@/lib/templates/service";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return publicRead(async () => catalogDetail((await params).slug));
}
