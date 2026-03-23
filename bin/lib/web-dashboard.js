/**
 * web-dashboard.js — Rich Web UI / Local Dashboard (Item 61)
 *
 * Serve a local web control center for project management,
 * phase tracking, artifact browsing, and governance overview.
 *
 * Usage:
 *   node bin/lib/web-dashboard.js start|status|config [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = 'localhost';

const DASHBOARD_SECTIONS = ['phases', 'artifacts', 'governance', 'timeline', 'risks', 'metrics'];

/**
 * Generate dashboard configuration.
 */
function generateConfig(root, options = {}) {
  const port = options.port || DEFAULT_PORT;
  const host = options.host || DEFAULT_HOST;
  
  const config = {
    port,
    host,
    root: path.resolve(root),
    sections: options.sections || DASHBOARD_SECTIONS,
    theme: options.theme || 'default',
    auth: options.auth || { enabled: false },
    refresh_interval: options.refresh_interval || 30,
    generated_at: new Date().toISOString()
  };
  
  return { success: true, config };
}

/**
 * Gather dashboard data from project state.
 */
function gatherDashboardData(root, options = {}) {
  const data = {
    project_root: root,
    generated_at: new Date().toISOString(),
    sections: {}
  };

  // Phase status
  const stateFile = path.join(root, '.jumpstart', 'state', 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      data.sections.phases = {
        current_phase: state.current_phase || 0,
        current_agent: state.current_agent || null,
        last_completed_step: state.last_completed_step || null
      };
    } catch { data.sections.phases = { current_phase: 0 }; }
  } else {
    data.sections.phases = { current_phase: 0 };
  }

  // Artifacts
  const specsDir = path.join(root, 'specs');
  const artifacts = [];
  if (fs.existsSync(specsDir)) {
    for (const f of fs.readdirSync(specsDir).filter(f => f.endsWith('.md'))) {
      const fp = path.join(specsDir, f);
      const stat = fs.statSync(fp);
      artifacts.push({ name: f, size: stat.size, modified: stat.mtime.toISOString() });
    }
  }
  data.sections.artifacts = { total: artifacts.length, files: artifacts };

  // Config summary
  const configFile = path.join(root, '.jumpstart', 'config.yaml');
  data.sections.config = { exists: fs.existsSync(configFile) };

  return { success: true, ...data };
}

/**
 * Generate static HTML dashboard.
 */
function generateStaticDashboard(data) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Jump Start Dashboard</title></head>
<body>
<h1>Jump Start Dashboard</h1>
<p>Generated: ${data.generated_at}</p>
<h2>Phase Status</h2>
<p>Current Phase: ${data.sections.phases.current_phase}</p>
<h2>Artifacts (${data.sections.artifacts.total})</h2>
<ul>${data.sections.artifacts.files.map(f => `<li>${f.name} (${f.size} bytes)</li>`).join('')}</ul>
</body>
</html>`;
  return { success: true, html };
}

/**
 * Get server status.
 */
function getServerStatus(options = {}) {
  return {
    success: true,
    running: false,
    port: options.port || DEFAULT_PORT,
    host: options.host || DEFAULT_HOST,
    uptime: null
  };
}

module.exports = {
  generateConfig,
  gatherDashboardData,
  generateStaticDashboard,
  getServerStatus,
  DASHBOARD_SECTIONS,
  DEFAULT_PORT,
  DEFAULT_HOST
};
