# Jump Start Skills Directory

> **Purpose:** Skills are modular, self-contained packages that extend AI agent capabilities with specialized domain knowledge, workflows, and tool integrations.

---

## Installed Skills

| Skill | Description | Status |
|-------|-------------|--------|
| `skill-creator` | Guide for creating effective skills | Built-in |
| `linkedin` | LinkedIn profile optimization and professional networking | Example |
| `requirements` | Requirements elicitation and analysis techniques | Example |
| `ui-ux-pro-max` | AI-powered design intelligence for professional UI/UX across multiple platforms and frameworks | Installed |

---

## Skill Anatomy

Every skill follows this directory structure:

```
skill-name/
├── SKILL.md              (required — YAML frontmatter + instructions)
├── scripts/              (optional — executable helpers)
├── references/           (optional — reference docs, patterns)
├── assets/               (optional — images, data files)
└── LICENSE.txt            (optional — license terms)
```

The `SKILL.md` file must include YAML frontmatter with at minimum:
- `name` — Skill identifier (kebab-case)
- `description` — What the skill provides (one sentence)

---

## Creating a New Skill

Use the built-in **skill-creator** skill for guided creation:

1. Run: "Create a new skill using the skill-creator"
2. The skill-creator will walk you through the process:
   - Define the skill's purpose and scope
   - Structure instructions for optimal token efficiency
   - Set appropriate degrees of freedom
   - Add scripts and references if needed
3. Validate with `scripts/quick_validate.py`
4. Package with `scripts/package_skill.py`

See `.jumpstart/skills/skill-creator/SKILL.md` for the complete creation guide.

---

## Installing Skills

### From a Module

Skills can be bundled in Jump Start modules. When a module is loaded via `.jumpstart/modules/`, its declared skills are automatically available.

### Manual Installation

1. Copy the skill directory to `.jumpstart/skills/`
2. Ensure `SKILL.md` exists with valid frontmatter
3. The skill is immediately available for reference

---

## Using Skills

Reference a skill in your prompt by mentioning its name. The AI agent will read the skill's `SKILL.md` to gain its specialized knowledge. Skills are additive — they extend the agent's capabilities without replacing core behavior.

---

## Configuration

Skills are controlled via `.jumpstart/config.yaml`:

```yaml
skills:
  enabled: true
  dir: .jumpstart/skills
```

When `skills.enabled` is `true`, agents can discover and load skills from the configured directory.
