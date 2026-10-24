import { BrowserWorkspace } from "@/components/browser-workspace";
import { slotsConfigured } from "@/src/core";
import { readSettingsRecord } from "@/src/server";

export const dynamic = "force-dynamic";

export default function BrowsePage() {
	const record = readSettingsRecord();
	return <BrowserWorkspace initialConfigured={slotsConfigured(record?.models)} />;
}
