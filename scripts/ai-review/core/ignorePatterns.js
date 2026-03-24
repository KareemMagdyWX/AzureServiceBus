// ─── Files and folders to skip during review ───

export const IGNORED_PATTERNS = [
  // Build output
  "bin/",
  "obj/",
  "publish/",
  "out/",

  // Configuration & secrets
  "appsettings.json",
  "appsettings.Development.json",
  "appsettings.Production.json",
  "appsettings.Staging.json",
  "launchSettings.json",
  "web.config",

  // IDE & tooling
  ".vs/",
  ".vscode/",
  ".idea/",
  ".user",
  ".suo",
  ".DotSettings",

  // Package management
  "packages/",
  "node_modules/",

  // Auto-generated code
  "Migrations/",
  ".Designer.cs",
  ".g.cs",
  ".AssemblyInfo.cs",

  // Project metadata
  ".csproj",
  ".sln",
  ".config",
  ".props",
  ".targets",

  // Static assets & test output
  "wwwroot/lib/",
  "TestResults/",
  "coverage/",
  ".min.js",
  ".min.css",

  // Lock files
  "packages.lock.json",
  ".lock",
];

// ─── File extensions we want to review ───

export const REVIEWABLE_EXTENSIONS = [
  ".cs",
  ".razor",
  ".cshtml",
  ".fs",
  ".fsx",
];
