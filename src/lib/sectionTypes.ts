// Mirrors public.section_types in Supabase. Headers are FIXED — the agent
// only ever fills in "subject" content for a given header, it never
// invents or renames headers.
export const SECTION_TYPES = [
  { key: "contact_info", label: "Contact Information", repeatable: false, editable: false },
  { key: "professional_summary", label: "Professional Summary", repeatable: false, editable: true },
  { key: "technical_skills", label: "Technical Skills", repeatable: false, editable: true },
  { key: "experience", label: "Experience", repeatable: true, editable: true },
  { key: "projects", label: "Projects", repeatable: true, editable: true },
  { key: "education", label: "Education", repeatable: true, editable: false },
  { key: "certifications", label: "Certifications", repeatable: true, editable: true },
  { key: "achievements", label: "Achievements", repeatable: true, editable: true },
  { key: "publications", label: "Publications", repeatable: true, editable: true }
] as const;

export type SectionKey = typeof SECTION_TYPES[number]["key"];
