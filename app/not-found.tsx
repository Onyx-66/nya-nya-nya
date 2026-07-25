import { NyaScansApp } from "@/components/nyascans/NyaScansApp";

export default function NotFound() {
  return <NyaScansApp view="error" actor={null} resourceSlug="404" />;
}
