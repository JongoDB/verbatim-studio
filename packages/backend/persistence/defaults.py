"""Default project types and recording templates seeded on startup."""

DEFAULT_PROJECT_TYPES = [
    {
        "name": "Legal Case",
        "description": "Legal matter or case with parties, court info, and matter details",
        "metadata_schema": [
            {"name": "case_number", "label": "Case Number", "field_type": "text", "required": True},
            {"name": "plaintiff", "label": "Plaintiff", "field_type": "text"},
            {"name": "defendant", "label": "Defendant", "field_type": "text"},
            {"name": "court", "label": "Court", "field_type": "text"},
            {"name": "judge", "label": "Judge", "field_type": "text"},
            {"name": "case_type", "label": "Case Type", "field_type": "select", "options": ["Civil", "Criminal", "Family", "Corporate", "Other"]},
            {"name": "filing_date", "label": "Filing Date", "field_type": "date"},
            {"name": "status", "label": "Status", "field_type": "select", "options": ["Active", "Pending", "Closed", "Appeal"], "default_value": "Active"},
        ],
    },
    {
        "name": "Patient Care",
        "description": "Healthcare and patient management with medical record tracking",
        "metadata_schema": [
            {"name": "patient_id", "label": "Patient ID", "field_type": "text", "required": True},
            {"name": "mrn", "label": "Medical Record Number (MRN)", "field_type": "text"},
            {"name": "dob", "label": "Date of Birth", "field_type": "date"},
            {"name": "insurance_info", "label": "Insurance Information", "field_type": "textarea"},
            {"name": "diagnosis_codes", "label": "Diagnosis Codes (ICD-10)", "field_type": "textarea"},
            {"name": "procedure_codes", "label": "Procedure Codes (CPT)", "field_type": "textarea"},
            {"name": "primary_physician", "label": "Primary Physician", "field_type": "text"},
        ],
    },
    {
        "name": "Clinical Trial",
        "description": "Clinical research trial with protocol and IRB tracking",
        "metadata_schema": [
            {"name": "protocol_number", "label": "Protocol Number", "field_type": "text", "required": True},
            {"name": "irb_approval", "label": "IRB Approval Number", "field_type": "text"},
            {"name": "study_phase", "label": "Study Phase", "field_type": "select", "options": ["Phase I", "Phase II", "Phase III", "Phase IV"]},
            {"name": "principal_investigator", "label": "Principal Investigator", "field_type": "text", "required": True},
            {"name": "enrollment_period", "label": "Enrollment Period", "field_type": "text"},
            {"name": "participant_count", "label": "Participant Count", "field_type": "number"},
        ],
    },
    {
        "name": "Research Study",
        "description": "Academic or scientific research project",
        "metadata_schema": [
            {"name": "study_id", "label": "Study ID", "field_type": "text", "required": True},
            {"name": "ethics_approval", "label": "IRB/Ethics Approval Number", "field_type": "text"},
            {"name": "research_type", "label": "Research Type", "field_type": "select", "options": ["Qualitative", "Quantitative", "Mixed Methods", "Literature Review"]},
            {"name": "principal_investigator", "label": "Principal Investigator", "field_type": "text", "required": True},
            {"name": "funding_source", "label": "Funding Source", "field_type": "text"},
            {"name": "start_date", "label": "Start Date", "field_type": "date"},
            {"name": "end_date", "label": "End Date", "field_type": "date"},
        ],
    },
    {
        "name": "Thesis/Dissertation",
        "description": "Graduate thesis or dissertation project",
        "metadata_schema": [
            {"name": "student_id", "label": "Student ID", "field_type": "text", "required": True},
            {"name": "degree_program", "label": "Degree Program", "field_type": "text", "required": True},
            {"name": "advisor", "label": "Advisor", "field_type": "text", "required": True},
            {"name": "committee_members", "label": "Committee Members", "field_type": "textarea"},
            {"name": "defense_date", "label": "Defense Date", "field_type": "date"},
            {"name": "approval_status", "label": "Approval Status", "field_type": "select", "options": ["In Progress", "Submitted", "Defended", "Approved", "Revisions Required"], "default_value": "In Progress"},
        ],
    },
    {
        "name": "Investigation",
        "description": "Formal investigation with complainant and respondent tracking",
        "metadata_schema": [
            {"name": "case_number", "label": "Case Number", "field_type": "text", "required": True},
            {"name": "complainant", "label": "Complainant (Anonymized)", "field_type": "text"},
            {"name": "respondent", "label": "Respondent (Anonymized)", "field_type": "text"},
            {"name": "investigation_type", "label": "Investigation Type", "field_type": "select", "options": ["HR", "Compliance", "Fraud", "Ethics", "Safety", "Other"]},
            {"name": "assigned_investigator", "label": "Assigned Investigator", "field_type": "text"},
            {"name": "confidentiality_level", "label": "Confidentiality Level", "field_type": "select", "options": ["Public", "Confidential", "Highly Confidential"], "default_value": "Confidential"},
        ],
    },
    {
        "name": "Regulatory Hearing",
        "description": "Government or regulatory agency hearing",
        "metadata_schema": [
            {"name": "docket_number", "label": "Docket Number", "field_type": "text", "required": True},
            {"name": "regulatory_body", "label": "Regulatory Body", "field_type": "text", "required": True},
            {"name": "presiding_officer", "label": "Presiding Officer", "field_type": "text"},
            {"name": "parties_of_record", "label": "Parties of Record", "field_type": "textarea"},
            {"name": "hearing_type", "label": "Hearing Type", "field_type": "select", "options": ["Administrative", "Adjudicatory", "Rulemaking", "Public Comment"]},
            {"name": "public_status", "label": "Public Status", "field_type": "select", "options": ["Public", "Sealed", "Partially Sealed"], "default_value": "Public"},
        ],
    },
    {
        "name": "Legislative Session",
        "description": "Legislative body meeting or session",
        "metadata_schema": [
            {"name": "legislative_body", "label": "Legislative Body", "field_type": "text", "required": True},
            {"name": "session_number", "label": "Session Number", "field_type": "text", "required": True},
            {"name": "session_year", "label": "Session Year", "field_type": "number", "required": True},
            {"name": "jurisdiction", "label": "Jurisdiction", "field_type": "text"},
            {"name": "chamber", "label": "Chamber", "field_type": "select", "options": ["Senate", "House", "Assembly", "Joint", "Committee"]},
        ],
    },
    {
        "name": "Property Transaction",
        "description": "Real estate transaction with property and agent details",
        "metadata_schema": [
            {"name": "property_address", "label": "Property Address", "field_type": "textarea", "required": True},
            {"name": "mls_number", "label": "MLS Number", "field_type": "text"},
            {"name": "transaction_type", "label": "Transaction Type", "field_type": "select", "options": ["Purchase", "Sale", "Lease", "Rental"]},
            {"name": "listing_agent", "label": "Listing Agent", "field_type": "text"},
            {"name": "buyer_agent", "label": "Buyer Agent", "field_type": "text"},
            {"name": "closing_date_target", "label": "Target Closing Date", "field_type": "date"},
        ],
    },
]

DEFAULT_RECORDING_TEMPLATES = [
    {
        "name": "General Recording",
        "description": "Default template for recordings with basic metadata only",
        "metadata_schema": [
            {"name": "title", "label": "Title", "field_type": "text"},
            {"name": "date", "label": "Date", "field_type": "date"},
            {"name": "notes", "label": "Notes", "field_type": "textarea"},
        ],
    },
    {
        "name": "Meeting Minutes",
        "description": "Team meetings, standups, planning sessions",
        "metadata_schema": [
            {"name": "meeting_date", "label": "Meeting Date", "field_type": "date", "required": True},
            {"name": "attendees", "label": "Attendees", "field_type": "textarea", "required": True},
            {"name": "agenda_items", "label": "Agenda Items", "field_type": "textarea"},
            {"name": "action_items", "label": "Action Items", "field_type": "textarea"},
            {"name": "decisions_made", "label": "Decisions Made", "field_type": "textarea"},
            {"name": "next_meeting_date", "label": "Next Meeting Date", "field_type": "date"},
        ],
    },
    {
        "name": "Interview",
        "description": "Job interviews, research interviews, informational interviews",
        "metadata_schema": [
            {"name": "interviewer", "label": "Interviewer", "field_type": "text", "required": True},
            {"name": "interviewee", "label": "Interviewee", "field_type": "text", "required": True},
            {"name": "position_role", "label": "Position/Role", "field_type": "text"},
            {"name": "interview_type", "label": "Interview Type", "field_type": "select", "options": ["Phone", "Video", "In-Person"]},
            {"name": "key_topics", "label": "Key Topics", "field_type": "textarea"},
        ],
    },
    {
        "name": "Lecture/Training",
        "description": "Educational lectures, training sessions, workshops",
        "metadata_schema": [
            {"name": "instructor", "label": "Instructor", "field_type": "text", "required": True},
            {"name": "course_code", "label": "Course Code", "field_type": "text"},
            {"name": "session_number", "label": "Session Number", "field_type": "number"},
            {"name": "topic", "label": "Topic", "field_type": "text", "required": True},
            {"name": "learning_objectives", "label": "Learning Objectives", "field_type": "textarea"},
        ],
    },
    {
        "name": "Deposition",
        "description": "Legal depositions with witness examination",
        "metadata_schema": [
            {"name": "deponent_name", "label": "Deponent Name", "field_type": "text", "required": True},
            {"name": "case_reference", "label": "Case Reference", "field_type": "text", "required": True},
            {"name": "attorney_present", "label": "Attorney Present", "field_type": "text"},
            {"name": "court_reporter", "label": "Court Reporter", "field_type": "text"},
            {"name": "examination_type", "label": "Examination Type", "field_type": "select", "options": ["Direct", "Cross", "Redirect", "Recross"]},
        ],
    },
    {
        "name": "Patient Consultation",
        "description": "Medical consultations and patient visits",
        "metadata_schema": [
            {"name": "appointment_type", "label": "Appointment Type", "field_type": "select", "options": ["Initial", "Follow-up", "Emergency", "Telehealth"]},
            {"name": "chief_complaint", "label": "Chief Complaint", "field_type": "textarea", "required": True},
            {"name": "duration_minutes", "label": "Duration (minutes)", "field_type": "number"},
            {"name": "follow_up_needed", "label": "Follow-up Needed", "field_type": "select", "options": ["Yes", "No", "As Needed"]},
        ],
    },
    {
        "name": "Sales Call",
        "description": "Sales calls and client prospecting",
        "metadata_schema": [
            {"name": "prospect_name", "label": "Prospect Name", "field_type": "text", "required": True},
            {"name": "company", "label": "Company", "field_type": "text"},
            {"name": "deal_stage", "label": "Deal Stage", "field_type": "select", "options": ["Discovery", "Demo", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]},
            {"name": "products_discussed", "label": "Products Discussed", "field_type": "textarea"},
            {"name": "objections_raised", "label": "Objections Raised", "field_type": "textarea"},
        ],
    },
]
