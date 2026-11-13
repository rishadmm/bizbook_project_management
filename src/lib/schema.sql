-- Operations Module schema (SPEC section 3). All statements are idempotent.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, module TEXT NOT NULL, action TEXT NOT NULL,
  PRIMARY KEY (role_id, module, action)
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, code TEXT,
  head_user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  password_hash TEXT, status TEXT NOT NULL DEFAULT 'active',
  role_id INTEGER REFERENCES roles(id), phone TEXT, job_title TEXT,
  must_change_password INTEGER DEFAULT 0, failed_attempts INTEGER DEFAULT 0, locked_until TEXT,
  last_login_at TEXT, password_changed_at TEXT, manager_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, module TEXT NOT NULL, action TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  PRIMARY KEY (user_id, module, action)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT, ip TEXT, user_agent TEXT, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, email TEXT, event TEXT NOT NULL,
  ip TEXT, user_agent TEXT, detail TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'other',
  contact_person TEXT, email TEXT, phone TEXT, address TEXT, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  category TEXT, filename TEXT NOT NULL, stored_path TEXT NOT NULL, mime TEXT, size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  action TEXT NOT NULL, message TEXT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'tender', category TEXT NOT NULL DEFAULT 'other',
  location TEXT, scope_summary TEXT, technical_spec TEXT,
  quantity REAL, quantity_unit TEXT,
  issue_date TEXT, clarification_deadline TEXT, submission_deadline TEXT,
  bid_bond_amount REAL, estimated_value REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_revision_id INTEGER,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  probability_pct REAL DEFAULT 0, submitted_at TEXT, decided_at TEXT, won_value REAL,
  project_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tender_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  title TEXT NOT NULL, content TEXT, status TEXT NOT NULL DEFAULT 'not_started',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL, due_date TEXT, completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tender_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  rev_no INTEGER NOT NULL DEFAULT 0, label TEXT, reason TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_cost REAL DEFAULT 0, total_price REAL DEFAULT 0, margin_pct REAL DEFAULT 0,
  submitted_at TEXT, client_feedback TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES tender_revisions(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  sort INTEGER DEFAULT 0, category TEXT NOT NULL, item_code TEXT, description TEXT NOT NULL,
  unit TEXT, quantity REAL NOT NULL DEFAULT 0, unit_cost REAL NOT NULL DEFAULT 0,
  margin_pct REAL NOT NULL DEFAULT 0,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  notes TEXT, wbs_stage TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS margin_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL,
  revision_id INTEGER NOT NULL REFERENCES tender_revisions(id) ON DELETE CASCADE,
  old_margin REAL, new_margin REAL, reason TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tender_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  revision_id INTEGER REFERENCES tender_revisions(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision TEXT NOT NULL DEFAULT 'pending', comment TEXT, decided_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS negotiations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  revision_id INTEGER REFERENCES tender_revisions(id) ON DELETE SET NULL,
  date TEXT, channel TEXT DEFAULT 'meeting', summary TEXT, client_position TEXT, our_position TEXT,
  client_target_price REAL, outcome TEXT, next_step TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS loss_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  primary_reason TEXT NOT NULL DEFAULT 'other', secondary_reasons TEXT,
  winner_name TEXT, winner_price REAL, our_price REAL, price_gap_pct REAL, technical_score REAL,
  client_feedback TEXT, root_cause TEXT, lessons_learned TEXT, action_items TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT, region TEXT, location TEXT,
  contract_value REAL DEFAULT 0, budget_cost REAL DEFAULT 0,
  start_date TEXT, end_date TEXT, status TEXT NOT NULL DEFAULT 'planning',
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  total_quantity REAL, quantity_unit TEXT, geometry TEXT, description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT, name TEXT NOT NULL, description TEXT, sort INTEGER DEFAULT 0, geometry TEXT,
  planned_quantity REAL DEFAULT 0, quantity_unit TEXT, chainage_from REAL, chainage_to REAL,
  planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
  budget_amount REAL DEFAULT 0, status TEXT NOT NULL DEFAULT 'not_started', weight_pct REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS project_budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  category TEXT NOT NULL, description TEXT, unit TEXT, quantity REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0, budget_amount REAL DEFAULT 0,
  source_budget_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subcontractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT NOT NULL, trade TEXT, categories TEXT,
  contact_person TEXT, email TEXT, phone TEXT, address TEXT,
  trade_license_no TEXT, trade_license_expiry TEXT, tax_no TEXT, bank_name TEXT, iban TEXT,
  status TEXT NOT NULL DEFAULT 'prospect', rating REAL, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subcontractor_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL, ref_no TEXT, issue_date TEXT, expiry_date TEXT,
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS onboarding_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  item TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER REFERENCES users(id) ON DELETE SET NULL, done_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE RESTRICT,
  scope TEXT, contract_value REAL DEFAULT 0, quantity REAL, quantity_unit TEXT, unit_rate REAL,
  start_date TEXT, end_date TEXT, payment_terms TEXT,
  advance_pct REAL DEFAULT 0, retention_pct REAL DEFAULT 0, payment_days INTEGER DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'draft', portal_token TEXT UNIQUE, portal_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS progress_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL, quantity_done REAL DEFAULT 0, cumulative_quantity REAL DEFAULT 0,
  percent_complete REAL DEFAULT 0, manpower_count INTEGER DEFAULT 0, man_hours REAL DEFAULT 0,
  equipment_used TEXT, work_done TEXT, issues TEXT,
  delay_days REAL DEFAULT 0, delay_cause TEXT, delay_responsibility TEXT DEFAULT 'none',
  geometry TEXT, source TEXT NOT NULL DEFAULT 'internal', status TEXT NOT NULL DEFAULT 'submitted',
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL, verified_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS progress_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  progress_report_id INTEGER NOT NULL REFERENCES progress_reports(id) ON DELETE CASCADE,
  material TEXT NOT NULL, unit TEXT, quantity REAL DEFAULT 0, unit_cost REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS progress_manpower (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  progress_report_id INTEGER NOT NULL REFERENCES progress_reports(id) ON DELETE CASCADE,
  trade TEXT NOT NULL, headcount INTEGER DEFAULT 0, hours REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sub_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  invoice_no TEXT, invoice_date TEXT, period_from TEXT, period_to TEXT,
  claimed_amount REAL DEFAULT 0, claimed_percent REAL DEFAULT 0, certified_amount REAL DEFAULT 0,
  retention_amount REAL DEFAULT 0, advance_recovery REAL DEFAULT 0, net_payable REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted', paid_amount REAL DEFAULT 0, paid_date TEXT,
  source TEXT NOT NULL DEFAULT 'internal', notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS completion_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  cert_type TEXT NOT NULL DEFAULT 'partial', cert_no TEXT, cert_date TEXT, percent REAL, quantity REAL,
  remarks TEXT, status TEXT NOT NULL DEFAULT 'draft',
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL, source TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS project_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  category TEXT NOT NULL, description TEXT, amount REAL NOT NULL DEFAULT 0, cost_date TEXT,
  source_type TEXT, source_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT, responsibility TEXT DEFAULT 'other',
  impact_days REAL DEFAULT 0, impact_cost REAL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
  raised_on TEXT, resolved_on TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes on every FK
CREATE INDEX IF NOT EXISTS idx_users_dept ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_attach_entity ON attachments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attach_user ON attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_tenders_client ON tenders(client_id);
CREATE INDEX IF NOT EXISTS idx_tenders_owner ON tenders(owner_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tsec_tender ON tender_sections(tender_id);
CREATE INDEX IF NOT EXISTS idx_tsec_dept ON tender_sections(department_id);
CREATE INDEX IF NOT EXISTS idx_tsec_assignee ON tender_sections(assignee_id);
CREATE INDEX IF NOT EXISTS idx_trev_tender ON tender_revisions(tender_id);
CREATE INDEX IF NOT EXISTS idx_trev_user ON tender_revisions(created_by);
CREATE INDEX IF NOT EXISTS idx_bl_rev ON budget_lines(revision_id);
CREATE INDEX IF NOT EXISTS idx_bl_tender ON budget_lines(tender_id);
CREATE INDEX IF NOT EXISTS idx_bl_dept ON budget_lines(department_id);
CREATE INDEX IF NOT EXISTS idx_mc_line ON margin_changes(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_mc_rev ON margin_changes(revision_id);
CREATE INDEX IF NOT EXISTS idx_mc_user ON margin_changes(user_id);
CREATE INDEX IF NOT EXISTS idx_trv_tender ON tender_reviews(tender_id);
CREATE INDEX IF NOT EXISTS idx_trv_rev ON tender_reviews(revision_id);
CREATE INDEX IF NOT EXISTS idx_trv_dept ON tender_reviews(department_id);
CREATE INDEX IF NOT EXISTS idx_trv_reviewer ON tender_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_neg_tender ON negotiations(tender_id);
CREATE INDEX IF NOT EXISTS idx_neg_rev ON negotiations(revision_id);
CREATE INDEX IF NOT EXISTS idx_loss_tender ON loss_analyses(tender_id);
CREATE INDEX IF NOT EXISTS idx_loss_owner ON loss_analyses(owner_id);
CREATE INDEX IF NOT EXISTS idx_proj_tender ON projects(tender_id);
CREATE INDEX IF NOT EXISTS idx_proj_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_proj_parent ON projects(parent_id);
CREATE INDEX IF NOT EXISTS idx_proj_manager ON projects(manager_id);
CREATE INDEX IF NOT EXISTS idx_stage_project ON stages(project_id);
CREATE INDEX IF NOT EXISTS idx_pbl_project ON project_budget_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_pbl_stage ON project_budget_lines(stage_id);
CREATE INDEX IF NOT EXISTS idx_pbl_src ON project_budget_lines(source_budget_line_id);
CREATE INDEX IF NOT EXISTS idx_sdoc_sub ON subcontractor_documents(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_sdoc_att ON subcontractor_documents(attachment_id);
CREATE INDEX IF NOT EXISTS idx_onb_sub ON onboarding_checklist(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_onb_user ON onboarding_checklist(done_by);
CREATE INDEX IF NOT EXISTS idx_asg_project ON assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_asg_stage ON assignments(stage_id);
CREATE INDEX IF NOT EXISTS idx_asg_sub ON assignments(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_pr_asg ON progress_reports(assignment_id);
CREATE INDEX IF NOT EXISTS idx_pr_stage ON progress_reports(stage_id);
CREATE INDEX IF NOT EXISTS idx_pr_project ON progress_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_pr_verifier ON progress_reports(verified_by);
CREATE INDEX IF NOT EXISTS idx_pm_report ON progress_materials(progress_report_id);
CREATE INDEX IF NOT EXISTS idx_pmp_report ON progress_manpower(progress_report_id);
CREATE INDEX IF NOT EXISTS idx_inv_asg ON sub_invoices(assignment_id);
CREATE INDEX IF NOT EXISTS idx_inv_project ON sub_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_cert_asg ON completion_certificates(assignment_id);
CREATE INDEX IF NOT EXISTS idx_cert_project ON completion_certificates(project_id);
CREATE INDEX IF NOT EXISTS idx_cert_stage ON completion_certificates(stage_id);
CREATE INDEX IF NOT EXISTS idx_cert_issuer ON completion_certificates(issued_by);
CREATE INDEX IF NOT EXISTS idx_pc_project ON project_costs(project_id);
CREATE INDEX IF NOT EXISTS idx_pc_stage ON project_costs(stage_id);
CREATE INDEX IF NOT EXISTS idx_pc_source ON project_costs(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_issue_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_stage ON issues(stage_id);
CREATE INDEX IF NOT EXISTS idx_issue_asg ON issues(assignment_id);
