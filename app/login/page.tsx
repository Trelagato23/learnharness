import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/src/core";
import { loginRequired } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string }>;
}) {
	if (!loginRequired()) redirect("/");
	const { next } = await searchParams;
	return (
		<div className="flex min-h-dvh items-center justify-center px-4 py-8">
			<LoginForm nextPath={safeNextPath(next)} />
		</div>
	);
}
