import { createFileRoute } from "@tanstack/react-router";
import { CrossMatApp } from "@/components/crossmat-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <CrossMatApp />;
}
