import { FileCode2, FileJson, GitBranch, Link2, TestTube2, Wind } from "lucide-react";

export type Props = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  showFeedback: (title: string, message: string, variant?: string) => void;
  canEdit: boolean;
  initialProjectId?: string;
  embedded?: boolean;
};
export type Project = { id: string; nombre: string };
export type Profile = {
  id: string;
  tool: string;
  version: string;
  status: "stable" | "beta" | "blocked" | string;
  import_enabled?: boolean;
  extensions: string[];
  display_name?: string;
  verification_label?: string;
  verification_detail?: string;
  reason?: string;
};
export type Suite = { id: string; nombre: string; parent_id?: string | null };
export type Component = { id: string; nombre: string };
export type ImportBatch = {
  id: string;
  source_tool: string;
  source_version: string;
  file_name?: string | null;
  status: string;
  summary?: { new?: number; new_versions?: number };
  rollback_available: boolean;
};

export const profileVisual = (tool = "") => {
  const value = tool.toLowerCase();
  if (value === "treseko")
    return {
      Icon: FileJson,
      logo: "/tool-logos/treseko.png",
      initials: "TK",
      color: "#2563eb",
      background: "#dbeafe",
    };
  if (value === "csv")
    return {
      Icon: FileJson,
      logo: "/tool-logos/csv.svg",
      initials: "CSV",
      color: "#15803d",
      background: "#dcfce7",
    };
  if (value.includes("azure-test-plans"))
    return {
      Icon: GitBranch,
      logo: "/tool-logos/azure-test-plans.ico",
      initials: "AZ",
      color: "#0078d4",
      background: "#e0f2fe",
    };
  if (value === "qtest")
    return {
      Icon: TestTube2,
      logo: "/tool-logos/qtest.svg",
      initials: "QT",
      color: "#dc2626",
      background: "#fee2e2",
    };
  if (value === "practitest")
    return {
      Icon: TestTube2,
      logo: "/tool-logos/practitest.png",
      initials: "PT",
      color: "#334155",
      background: "#e2e8f0",
    };
  if (value.includes("testrail"))
    return {
      Icon: TestTube2,
      logo: "/tool-logos/testrail.svg",
      initials: "TR",
      color: "#047857",
      background: "#d1fae5",
    };
  if (value.includes("xray"))
    return {
      Icon: GitBranch,
      logo: "/tool-logos/xray.png",
      initials: "XR",
      color: "#7c3aed",
      background: "#ede9fe",
    };
  if (value.includes("zephyr"))
    return {
      Icon: Wind,
      logo: "/tool-logos/zephyr.svg",
      initials: "ZE",
      color: "#0369a1",
      background: "#e0f2fe",
    };
  if (value.includes("qase"))
    return {
      Icon: TestTube2,
      logo: "/tool-logos/qase.svg",
      initials: "QA",
      color: "#4338ca",
      background: "#e0e7ff",
    };
  if (value.includes("testlink"))
    return {
      Icon: Link2,
      logo: "/tool-logos/testlink.png",
      initials: "TL",
      color: "#b45309",
      background: "#fef3c7",
    };
  if (value.includes("gherkin"))
    return {
      Icon: FileCode2,
      logo: "/tool-logos/gherkin.svg",
      initials: "GH",
      color: "#15803d",
      background: "#dcfce7",
    };
  return {
    Icon: FileJson,
    logo: "/tool-logos/csv.svg",
    initials:
      tool
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 3)
        .toUpperCase() || "—",
    color: "#475569",
    background: "#e2e8f0",
  };
};

export const profileLabel = (tool = "", translate?: (key: string) => string) => {
  const labels: Record<string, string> = {
    treseko: "Treseko",
    csv: "configuracion.csvStructured",
    testlink: "TestLink",
    xray: "Xray",
    zephyr: "Zephyr",
    "zephyr-scale": "Zephyr Scale",
    "azure-test-plans": "Azure Test Plans",
    qtest: "qTest",
    practitest: "PractiTest",
    testrail: "TestRail",
    qase: "Qase",
    gherkin: "Gherkin",
  };
  const label = labels[tool.toLowerCase()] || tool;
  return translate && labels[tool.toLowerCase()] ? translate(label) : label;
};

export const profileStatus = (status = "", verified = false, translate?: (key: string) => string) => {
  const label = (key: string) => translate ? translate(key) : key;
  if (status === "stable") return { label: label("configuracion.statusStable"), bg: "success" };
  if (status === "supported") return { label: label("configuracion.statusSupported"), bg: "success" };
  if (status === "beta" || (!status && verified))
    return { label: label("configuracion.statusBeta"), bg: "warning" };
  return { label: label("configuracion.statusReview"), bg: "secondary" };
};

export const isProfileEnabled = (profile?: Profile) =>
  Boolean(profile) &&
  profile?.import_enabled !== false &&
  profile?.status !== "blocked";

export const profileVerification = (profile?: Profile) => {
  if (!profile) return null;
  if (profile.verification_label) {
    return {
      label: profile.verification_label,
      detail: profile.verification_detail,
    };
  }
  if (profile.id === "testlink/xml-v1") {
    return {
      label: "configuracion.verified",
      detail: "configuracion.testlinkVerificationDetail",
    };
  }
  return null;
};

export const readAsBase64 = (file: File, readError: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(readError));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
