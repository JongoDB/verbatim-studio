"""Default project types and recording templates seeded on startup."""

DEFAULT_PROJECT_TYPES = [
    {
        "name": "Legal Case",
        "description": "Legal proceedings, depositions, court recordings",
        "metadata_schema": [
            {"name": "case_number", "label": "Case Number", "field_type": "text", "required": True},
            {"name": "court", "label": "Court", "field_type": "text"},
            {"name": "judge", "label": "Judge", "field_type": "text"},
            {
                "name": "case_type",
                "label": "Case Type",
                "field_type": "select",
                "options": ["Civil", "Criminal", "Family", "Probate", "Appellate"],
            },
        ],
    },
    {
        "name": "Research Study",
        "description": "Academic or market research projects",
        "metadata_schema": [
            {"name": "study_id", "label": "Study ID", "field_type": "text", "required": True},
            {"name": "principal_investigator", "label": "Principal Investigator", "field_type": "text"},
            {"name": "institution", "label": "Institution", "field_type": "text"},
            {"name": "irb_number", "label": "IRB Number", "field_type": "text"},
        ],
    },
    {
        "name": "Client Project",
        "description": "Client work and consulting engagements",
        "metadata_schema": [
            {"name": "client_name", "label": "Client Name", "field_type": "text", "required": True},
            {"name": "project_code", "label": "Project Code", "field_type": "text"},
            {"name": "contact_email", "label": "Contact Email", "field_type": "text"},
            {"name": "budget", "label": "Budget", "field_type": "number"},
        ],
    },
    {
        "name": "Personal",
        "description": "Personal notes, journals, and recordings",
        "metadata_schema": [
            {
                "name": "category",
                "label": "Category",
                "field_type": "select",
                "options": ["Notes", "Ideas", "Journal", "Other"],
            },
        ],
    },
]

DEFAULT_RECORDING_TEMPLATES = [
    {
        "name": "General Recording",
        "description": "Default template with basic metadata",
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
        ],
    },
    {
        "name": "Interview",
        "description": "Job interviews, research interviews, informational interviews",
        "metadata_schema": [
            {"name": "interviewer", "label": "Interviewer", "field_type": "text", "required": True},
            {"name": "interviewee", "label": "Interviewee", "field_type": "text", "required": True},
            {"name": "position_role", "label": "Position/Role", "field_type": "text"},
            {
                "name": "interview_type",
                "label": "Interview Type",
                "field_type": "select",
                "options": ["Phone", "Video", "In-Person"],
            },
            {"name": "key_topics", "label": "Key Topics", "field_type": "textarea"},
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
            {
                "name": "examination_type",
                "label": "Examination Type",
                "field_type": "select",
                "options": ["Direct", "Cross", "Redirect", "Recross"],
            },
        ],
    },
    {
        "name": "Lecture",
        "description": "Educational lectures, training sessions, workshops",
        "metadata_schema": [
            {"name": "instructor", "label": "Instructor", "field_type": "text", "required": True},
            {"name": "course_code", "label": "Course Code", "field_type": "text"},
            {"name": "topic", "label": "Topic", "field_type": "text", "required": True},
            {"name": "learning_objectives", "label": "Learning Objectives", "field_type": "textarea"},
        ],
    },
]
