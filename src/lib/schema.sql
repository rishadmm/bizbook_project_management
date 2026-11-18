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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- invoice document (INVOICE_SPEC): claimed_amount = gross incl. VAT = subtotal + vat_amount
  sub_invoice_ref TEXT, currency TEXT NOT NULL DEFAULT 'AED', vat_rate REAL NOT NULL DEFAULT 5,
  subtotal REAL DEFAULT 0, vat_amount REAL DEFAULT 0, gross_amount REAL DEFAULT 0,
  retention_percent REAL DEFAULT 0, advance_recovery_percent REAL DEFAULT 0, previous_certified REAL DEFAULT 0,
  submitted_by_name TEXT, submitted_by_email TEXT, submitted_at TEXT, due_date TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, certified_by INTEGER REFERENCES users(id) ON DELETE SET NULL, certified_at TEXT,
  payment_ref TEXT, payment_method TEXT,
  erp_doc_no TEXT, erp_sync_status TEXT NOT NULL DEFAULT 'not_synced', erp_synced_at TEXT, erp_error TEXT
);
CREATE TABLE IF NOT EXISTS sub_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES sub_invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1, item_code TEXT, description TEXT NOT NULL, unit TEXT,
  contract_qty REAL DEFAULT 0, rate REAL DEFAULT 0, prev_qty REAL DEFAULT 0, this_qty REAL DEFAULT 0, cum_qty REAL DEFAULT 0,
  amount REAL DEFAULT 0, certified_qty REAL DEFAULT 0, certified_amount REAL DEFAULT 0, remarks TEXT,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invline_invoice ON sub_invoice_lines(invoice_id);
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

-- ---------------------------------------------------------------- Multi-level approval workflows (AUTH_SPEC section D)
CREATE TABLE IF NOT EXISTS approval_workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT, document_type TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0,
  condition_min_amount REAL, condition_max_amount REAL, condition_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  condition_project_category TEXT, created_by INTEGER, updated_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_aw_type ON approval_workflows(document_type, is_active);
CREATE TABLE IF NOT EXISTS approval_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id INTEGER NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  level_no INTEGER NOT NULL, name TEXT NOT NULL,
  approver_type TEXT NOT NULL CHECK (approver_type IN ('role','user','department','department_head','project_manager','requester_manager')),
  approver_role_id INTEGER, approver_user_id INTEGER, approver_department_id INTEGER,
  approval_mode TEXT NOT NULL DEFAULT 'any' CHECK (approval_mode IN ('any','all','min')), min_approvals INTEGER NOT NULL DEFAULT 1,
  min_amount REAL, sla_hours INTEGER NOT NULL DEFAULT 48, allow_self_approval INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_al_wf ON approval_levels(workflow_id);
CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, document_type TEXT NOT NULL, document_id INTEGER NOT NULL, document_ref TEXT, title TEXT,
  amount REAL NOT NULL DEFAULT 0, workflow_id INTEGER REFERENCES approval_workflows(id), current_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','returned','cancelled')),
  requested_by INTEGER, requested_at TEXT NOT NULL, completed_at TEXT, note TEXT,
  levels_json TEXT, payload TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ar_doc ON approval_requests(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_ar_by ON approval_requests(requested_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_one_open ON approval_requests(document_type, document_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS approval_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  level_no INTEGER NOT NULL, assignee_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','returned','skipped')),
  decision_comment TEXT, decided_at TEXT, decided_by INTEGER, delegated_from_user_id INTEGER, due_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_at_req ON approval_tasks(request_id);
CREATE INDEX IF NOT EXISTS idx_at_assignee ON approval_tasks(assignee_user_id, status);
CREATE TABLE IF NOT EXISTS approval_delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delegate_user_id INTEGER NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, document_types TEXT, is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ad_user ON approval_delegations(user_id);
CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  level_no INTEGER, event TEXT NOT NULL, user_id INTEGER, comment TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ae_req ON approval_events(request_id);
-- Manual project costs above the approval threshold wait here until approved (then posted to project_costs).
CREATE TABLE IF NOT EXISTS project_cost_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage_id INTEGER,
  category TEXT NOT NULL, description TEXT, amount REAL NOT NULL, cost_date TEXT, created_by INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pcr_project ON project_cost_requests(project_id);

-- ---------------------------------------------------------------- subcontractor portal (PORTAL_SPEC): users, sessions, audit, issue threads, change requests
CREATE TABLE IF NOT EXISTS portal_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, job_title TEXT,
  portal_role TEXT NOT NULL DEFAULT 'viewer',
  password_hash TEXT, status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
  last_login_at TEXT, previous_login_at TEXT, password_changed_at TEXT,
  assignment_scope TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_by_portal_user INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_users_email ON portal_users(subcontractor_id, lower(email));
CREATE TABLE IF NOT EXISTS portal_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
  portal_user_id INTEGER REFERENCES portal_users(id) ON DELETE CASCADE,
  subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  impersonated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT, ip TEXT, user_agent TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS portal_auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER, portal_user_id INTEGER, email TEXT, event TEXT NOT NULL,
  ip TEXT, user_agent TEXT, detail TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pae_sub ON portal_auth_events(subcontractor_id, id);
CREATE TABLE IF NOT EXISTS issue_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL, author_id INTEGER, author_name TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ic_issue ON issue_comments(issue_id);
CREATE TABLE IF NOT EXISTS portal_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  requested_by INTEGER, requested_by_name TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', decided_by INTEGER, decided_at TEXT, decision_note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pcr2_sub ON portal_change_requests(subcontractor_id, status);

-- ---------------------------------------------------------------- client portal (CLIENT_PORTAL_SPEC): read-only reporting users, sessions, audit
CREATE TABLE IF NOT EXISTS client_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, job_title TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  password_hash TEXT, status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
  last_login_at TEXT, previous_login_at TEXT, password_changed_at TEXT,
  project_scope TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_users_email ON client_users(client_id, lower(email));
CREATE TABLE IF NOT EXISTS client_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
  client_user_id INTEGER REFERENCES client_users(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  impersonated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT, ip TEXT, user_agent TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS client_auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, client_user_id INTEGER, email TEXT, event TEXT NOT NULL,
  ip TEXT, user_agent TEXT, detail TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cae_client ON client_auth_events(client_id, id);

-- ---------------------------------------------------------------- multi-country operations + USD reporting currency (MULTI_COUNTRY_SPEC)
CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, decimals INTEGER NOT NULL DEFAULT 2, symbol TEXT
);
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, country TEXT NOT NULL, flag TEXT, legal_name TEXT NOT NULL, short_name TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code), vat_rate REAL NOT NULL DEFAULT 5, tax_label TEXT NOT NULL DEFAULT 'TRN', tax_no TEXT, cr_no TEXT,
  address TEXT, phone TEXT, email TEXT, map_center TEXT, timezone TEXT, approval_cost_threshold REAL NOT NULL DEFAULT 50000,
  doc_prefix TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, currency TEXT NOT NULL REFERENCES currencies(code), rate_to_usd REAL NOT NULL,
  effective_date TEXT NOT NULL, source TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (currency, effective_date)
);
CREATE TABLE IF NOT EXISTS user_entities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_user_entities_entity ON user_entities(entity_id);

-- ---------------------------------------------------------------- supplier registration + procurement foundation (SUPPLIER_TENDERING_SPEC Part A, SCHEMA_VERSION 9)
-- New columns on subcontractors / subcontractor_documents are added by migrate.ts (ensureColumn); indexes on them live there as well.
CREATE TABLE IF NOT EXISTS supplier_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER REFERENCES entities(id), -- NULL = every country
  code TEXT NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT 'Others', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supcat_code ON supplier_categories(COALESCE(entity_id, 0), code);
CREATE TABLE IF NOT EXISTS subcontractor_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES supplier_categories(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'requested', -- requested | approved | declined
  UNIQUE(subcontractor_id, category_id)
);
CREATE TABLE IF NOT EXISTS subcontractor_experience (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  client TEXT, project TEXT, value REAL, currency TEXT, year INTEGER, description TEXT
);
CREATE TABLE IF NOT EXISTS subcontractor_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- primary | signatory | finance | hse
  name TEXT, title TEXT, email TEXT, phone TEXT,
  UNIQUE(subcontractor_id, role)
);
CREATE TABLE IF NOT EXISTS registration_doc_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL REFERENCES entities(id), code TEXT NOT NULL, name TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 0, needs_expiry INTEGER NOT NULL DEFAULT 0,
  category_condition TEXT, -- NULL = always; "group:<supplier_categories.group_name>" = only when the supplier requested a category of that group
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, UNIQUE(entity_id, code)
);
CREATE TABLE IF NOT EXISTS registration_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  decision TEXT NOT NULL, -- refer_back | approve | reject | resubmit | reopen
  note TEXT, items_json TEXT, decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL, decided_at TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_regrev_sub ON registration_reviews(subcontractor_id, id);
-- per-section / per-document reviewer verdicts of the current review round (section keys: company, categories, contacts, hse, experience; documents: doc type code)
CREATE TABLE IF NOT EXISTS registration_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL, item_ref TEXT NOT NULL, status TEXT NOT NULL, -- accepted | query | fixed
  comment TEXT, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT, fixed_at TEXT,
  UNIQUE(subcontractor_id, item_kind, item_ref)
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER REFERENCES entities(id), to_email TEXT NOT NULL, to_name TEXT, subject TEXT NOT NULL,
  body_html TEXT, body_text TEXT, template TEXT, related_type TEXT, related_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | logged | failed
  error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON email_outbox(entity_id, id);
CREATE TABLE IF NOT EXISTS portal_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  portal_user_id INTEGER REFERENCES portal_users(id) ON DELETE CASCADE, -- NULL = every user of the company
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, href TEXT, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pnotif_sub ON portal_notifications(subcontractor_id, read_at);
CREATE TABLE IF NOT EXISTS portal_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, portal_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- supplier tendering / RFx (SUPPLIER_TENDERING_SPEC Part B, SCHEMA_VERSION 10)
-- Entity rule: rfx_tenders is the root (entity_id); templates carry a nullable entity_id (NULL = every country); everything else is a child of its tender / bid / template and never
-- repeats entity_id. Money columns (rfx_tenders.estimate / award_value, rfx_boq_lines.estimate_rate, rfx_bids.total_amount / discount_amount / vat_amount, rfx_bid_prices.unit_rate / amount) get the
-- USD layer (fx-tables.ts). New assignment columns (source, rfx_id, rfx_bid_id) are added by migrate.ts.
CREATE TABLE IF NOT EXISTS rfx_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER REFERENCES entities(id), name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1,
  evaluation_method TEXT NOT NULL DEFAULT 'lowest_compliant', -- lowest_compliant | weighted | two_envelope_weighted
  tech_weight REAL NOT NULL DEFAULT 70, commercial_weight REAL NOT NULL DEFAULT 30, tech_pass_mark REAL NOT NULL DEFAULT 70,
  bid_bond_pct REAL NOT NULL DEFAULT 0, performance_bond_pct REAL NOT NULL DEFAULT 0, default_validity_days INTEGER NOT NULL DEFAULT 90,
  min_bidders INTEGER NOT NULL DEFAULT 3, clarification_days_before_close INTEGER NOT NULL DEFAULT 7, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rfx_template_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES rfx_templates(id) ON DELETE CASCADE, step_key TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL, gate TEXT NOT NULL DEFAULT 'pass_fail', weight REAL, pass_mark REAL, evaluator_role TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rfx_template_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, step_id INTEGER NOT NULL REFERENCES rfx_template_steps(id) ON DELETE CASCADE, criterion TEXT NOT NULL, max_score REAL NOT NULL DEFAULT 10, guidance TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rfx_template_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES rfx_templates(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'document',
  mandatory INTEGER NOT NULL DEFAULT 1, envelope TEXT NOT NULL DEFAULT 'technical', step_id INTEGER REFERENCES rfx_template_steps(id) ON DELETE SET NULL, instructions TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rfx_tenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL REFERENCES entities(id), code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, scope_kind TEXT NOT NULL DEFAULT 'stages', -- project | subproject | stages
  category_id INTEGER REFERENCES supplier_categories(id), procedure TEXT NOT NULL DEFAULT 'open', -- open | selective
  template_id INTEGER REFERENCES rfx_templates(id) ON DELETE SET NULL,
  evaluation_method TEXT NOT NULL DEFAULT 'lowest_compliant', tech_weight REAL NOT NULL DEFAULT 70, commercial_weight REAL NOT NULL DEFAULT 30, tech_pass_mark REAL NOT NULL DEFAULT 70, min_bidders INTEGER NOT NULL DEFAULT 3,
  estimate REAL, publish_at TEXT, clarification_deadline TEXT, site_visit_at TEXT, site_visit_note TEXT, closing_at TEXT, opening_at TEXT, validity_days INTEGER NOT NULL DEFAULT 90,
  bid_bond_pct REAL NOT NULL DEFAULT 0, performance_bond_pct REAL NOT NULL DEFAULT 0, advance_pct REAL NOT NULL DEFAULT 10, retention_pct REAL NOT NULL DEFAULT 5, payment_days INTEGER NOT NULL DEFAULT 30,
  payment_terms TEXT, contract_start TEXT, contract_end TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'draft',
  awarded_bid_id INTEGER, assignment_id INTEGER, cancel_reason TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  award_value REAL, recommended_bid_id INTEGER, recommendation_note TEXT, recommended_by INTEGER, recommended_at TEXT, published_at TEXT, closed_at TEXT, awarded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rfx_entity ON rfx_tenders(entity_id, status);
CREATE INDEX IF NOT EXISTS idx_rfx_project ON rfx_tenders(project_id);
CREATE TABLE IF NOT EXISTS rfx_scope (rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE, PRIMARY KEY (rfx_id, stage_id));
CREATE INDEX IF NOT EXISTS idx_rfx_scope_stage ON rfx_scope(stage_id);
CREATE TABLE IF NOT EXISTS rfx_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, step_key TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  gate TEXT NOT NULL DEFAULT 'pass_fail', weight REAL, pass_mark REAL, evaluator_role TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rfx_steps ON rfx_steps(rfx_id, sort);
CREATE TABLE IF NOT EXISTS rfx_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, step_id INTEGER NOT NULL REFERENCES rfx_steps(id) ON DELETE CASCADE, criterion TEXT NOT NULL, max_score REAL NOT NULL DEFAULT 10, guidance TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rfx_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'document',
  mandatory INTEGER NOT NULL DEFAULT 1, envelope TEXT NOT NULL DEFAULT 'technical', step_id INTEGER REFERENCES rfx_steps(id) ON DELETE SET NULL, instructions TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rfx_req ON rfx_requirements(rfx_id, sort);
CREATE TABLE IF NOT EXISTS rfx_boq_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, item_no TEXT NOT NULL, description TEXT NOT NULL, unit TEXT,
  quantity REAL NOT NULL DEFAULT 1, stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL, estimate_rate REAL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rfx_boq ON rfx_boq_lines(rfx_id, sort);
CREATE TABLE IF NOT EXISTS rfx_committee (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- chair | member | secretary | observer
  steps TEXT, -- JSON array of rfx_steps ids the member evaluates (NULL = every step)
  coi_declared_at TEXT, coi_conflict INTEGER NOT NULL DEFAULT 0, coi_note TEXT, UNIQUE (rfx_id, user_id)
);
CREATE TABLE IF NOT EXISTS rfx_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  invited_at TEXT, viewed_at TEXT, intent TEXT NOT NULL DEFAULT 'pending', decline_reason TEXT, source TEXT NOT NULL DEFAULT 'eligible', -- eligible | invited
  UNIQUE (rfx_id, subcontractor_id)
);
CREATE TABLE IF NOT EXISTS rfx_clarifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, subcontractor_id INTEGER REFERENCES subcontractors(id) ON DELETE SET NULL,
  question TEXT NOT NULL, asked_at TEXT NOT NULL, answer TEXT, answered_by INTEGER REFERENCES users(id) ON DELETE SET NULL, published_at TEXT
);
CREATE TABLE IF NOT EXISTS rfx_addenda (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, no INTEGER NOT NULL, title TEXT NOT NULL, description TEXT,
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL, new_closing_at TEXT, issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL, issued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rfx_addendum_acks (
  addendum_id INTEGER NOT NULL REFERENCES rfx_addenda(id) ON DELETE CASCADE, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE, acked_at TEXT NOT NULL,
  acked_by_name TEXT, PRIMARY KEY (addendum_id, subcontractor_id)
);
CREATE TABLE IF NOT EXISTS rfx_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- tech_opening | commercial_opening | opening | bafo_request | clarification_request
  at TEXT NOT NULL, attendees_json TEXT, minutes TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, data_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_rfx_events ON rfx_events(rfx_id, kind);
CREATE TABLE IF NOT EXISTS rfx_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | submitted | withdrawn | late_refused | disqualified | qualified | awarded | unsuccessful
  submitted_at TEXT, receipt_hash TEXT, revision INTEGER NOT NULL DEFAULT 0, total_amount REAL, discount_amount REAL NOT NULL DEFAULT 0, vat_amount REAL NOT NULL DEFAULT 0,
  validity_days INTEGER, deviations TEXT, alternative_offer TEXT, bid_bond_ref TEXT, price_version INTEGER NOT NULL DEFAULT 1,
  disqualified_step INTEGER, disqualify_reason TEXT, rank INTEGER, tech_score REAL, commercial_score REAL, final_score REAL,
  bid_bond_received INTEGER NOT NULL DEFAULT 0, register_note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT,
  UNIQUE (rfx_id, subcontractor_id)
);
CREATE TABLE IF NOT EXISTS rfx_bid_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bid_id INTEGER NOT NULL REFERENCES rfx_bids(id) ON DELETE CASCADE, revision INTEGER NOT NULL, submitted_at TEXT, receipt_hash TEXT, total_amount REAL, note TEXT
);
CREATE TABLE IF NOT EXISTS rfx_bid_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bid_id INTEGER NOT NULL REFERENCES rfx_bids(id) ON DELETE CASCADE, requirement_id INTEGER NOT NULL REFERENCES rfx_requirements(id) ON DELETE CASCADE,
  value_text TEXT, value_number REAL, attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL, compliant INTEGER, eval_comment TEXT, UNIQUE (bid_id, requirement_id)
);
CREATE TABLE IF NOT EXISTS rfx_bid_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bid_id INTEGER NOT NULL REFERENCES rfx_bids(id) ON DELETE CASCADE, boq_line_id INTEGER NOT NULL REFERENCES rfx_boq_lines(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1, unit_rate REAL NOT NULL DEFAULT 0, amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (bid_id, boq_line_id, version)
);
CREATE TABLE IF NOT EXISTS rfx_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bid_id INTEGER NOT NULL REFERENCES rfx_bids(id) ON DELETE CASCADE, step_id INTEGER NOT NULL REFERENCES rfx_steps(id) ON DELETE CASCADE,
  criterion_id INTEGER REFERENCES rfx_criteria(id) ON DELETE CASCADE, evaluator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, score REAL, compliant INTEGER, comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rfx_scores ON rfx_scores(bid_id, step_id, COALESCE(criterion_id, 0), evaluator_id);
CREATE TABLE IF NOT EXISTS rfx_signoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL, comment TEXT, decided_at TEXT NOT NULL, UNIQUE (rfx_id, user_id)
);
-- evaluation clarification and BAFO requests sent to one bidder through the portal
CREATE TABLE IF NOT EXISTS rfx_bid_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfx_id INTEGER NOT NULL REFERENCES rfx_tenders(id) ON DELETE CASCADE, bid_id INTEGER NOT NULL REFERENCES rfx_bids(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- clarification | bafo
  message TEXT NOT NULL, due_at TEXT, requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL, requested_at TEXT NOT NULL,
  response TEXT, responded_at TEXT, response_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'open' -- open | answered | expired
);
CREATE INDEX IF NOT EXISTS idx_rfx_breq ON rfx_bid_requests(bid_id, status);
