export function routeStatusLabel(locale: "ar" | "en", value: string) {
  const labels: Record<string, string> = locale === "ar"
    ? { active: "نشط", retired: "متقاعد", draft: "مسودة", published: "منشور", paused: "متوقف مؤقتاً" }
    : { active: "Active", retired: "Retired", draft: "Draft", published: "Published", paused: "Paused" };
  return Object.hasOwn(labels, value) ? labels[value] : locale === "ar" ? "الحالة" : "Status";
}
