"""Recording Template management endpoints."""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from uuid import uuid4
import json

from persistence import get_db, RecordingTemplateDB
from domain import RecordingTemplate, RecordingTemplateCreate, RecordingTemplateUpdate, MetadataField, ExportTemplateConfig

router = APIRouter()


@router.post("", response_model=RecordingTemplate, status_code=201)
async def create_recording_template(template: RecordingTemplateCreate, db: Session = Depends(get_db)):
    """
    Create a new recording template.

    Recording templates define metadata fields for individual recordings.
    Examples: "Meeting Minutes", "Interview", "Deposition", "Lecture"
    """
    template_id = str(uuid4())

    # Serialize nested models to JSON
    metadata_schema_json = json.dumps([field.model_dump() for field in template.metadata_schema])
    export_config_json = json.dumps(template.export_template_config.model_dump())

    # Create database record
    template_db = RecordingTemplateDB(
        id=template_id,
        name=template.name,
        description=template.description,
        metadata_schema=metadata_schema_json,
        export_template_config=export_config_json,
    )

    try:
        db.add(template_db)
        db.commit()
        db.refresh(template_db)
    except Exception as e:
        db.rollback()
        if "UNIQUE constraint failed" in str(e) or "duplicate key" in str(e):
            raise HTTPException(status_code=400, detail=f"Recording template '{template.name}' already exists")
        raise HTTPException(status_code=500, detail=str(e))

    # Parse back to Pydantic models
    metadata_schema = [MetadataField(**field) for field in json.loads(template_db.metadata_schema)]
    export_config = ExportTemplateConfig(**json.loads(template_db.export_template_config))

    return RecordingTemplate(
        id=template_db.id,
        name=template_db.name,
        description=template_db.description,
        metadata_schema=metadata_schema,
        export_template_config=export_config,
        created_at=template_db.created_at,
        updated_at=template_db.updated_at,
    )


@router.get("", response_model=list[RecordingTemplate])
async def list_recording_templates(db: Session = Depends(get_db)):
    """List all recording templates."""
    templates = db.query(RecordingTemplateDB).order_by(RecordingTemplateDB.name).all()

    return [
        RecordingTemplate(
            id=t.id,
            name=t.name,
            description=t.description,
            metadata_schema=[MetadataField(**field) for field in json.loads(t.metadata_schema)],
            export_template_config=ExportTemplateConfig(**json.loads(t.export_template_config)),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in templates
    ]


@router.get("/{template_id}", response_model=RecordingTemplate)
async def get_recording_template(template_id: str, db: Session = Depends(get_db)):
    """Get a specific recording template by ID."""
    template = db.query(RecordingTemplateDB).filter(RecordingTemplateDB.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="Recording template not found")

    metadata_schema = [MetadataField(**field) for field in json.loads(template.metadata_schema)]
    export_config = ExportTemplateConfig(**json.loads(template.export_template_config))

    return RecordingTemplate(
        id=template.id,
        name=template.name,
        description=template.description,
        metadata_schema=metadata_schema,
        export_template_config=export_config,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


@router.put("/{template_id}", response_model=RecordingTemplate)
async def update_recording_template(
    template_id: str, update: RecordingTemplateUpdate, db: Session = Depends(get_db)
):
    """Update a recording template."""
    template = db.query(RecordingTemplateDB).filter(RecordingTemplateDB.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="Recording template not found")

    # Update fields
    if update.name is not None:
        template.name = update.name

    if update.description is not None:
        template.description = update.description

    if update.metadata_schema is not None:
        metadata_schema_json = json.dumps([field.model_dump() for field in update.metadata_schema])
        template.metadata_schema = metadata_schema_json

    if update.export_template_config is not None:
        export_config_json = json.dumps(update.export_template_config.model_dump())
        template.export_template_config = export_config_json

    from datetime import datetime
    template.updated_at = datetime.utcnow()

    try:
        db.commit()
        db.refresh(template)
    except Exception as e:
        db.rollback()
        if "UNIQUE constraint failed" in str(e) or "duplicate key" in str(e):
            raise HTTPException(status_code=400, detail=f"Recording template name '{update.name}' already exists")
        raise HTTPException(status_code=500, detail=str(e))

    metadata_schema = [MetadataField(**field) for field in json.loads(template.metadata_schema)]
    export_config = ExportTemplateConfig(**json.loads(template.export_template_config))

    return RecordingTemplate(
        id=template.id,
        name=template.name,
        description=template.description,
        metadata_schema=metadata_schema,
        export_template_config=export_config,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


@router.delete("/{template_id}")
async def delete_recording_template(template_id: str, db: Session = Depends(get_db)):
    """
    Delete a recording template.

    Note: Recordings using this template will have their recording_template_id set to null.
    """
    template = db.query(RecordingTemplateDB).filter(RecordingTemplateDB.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="Recording template not found")

    # Unlink recordings from this template
    from persistence import RecordingDB
    db.query(RecordingDB).filter(RecordingDB.recording_template_id == template_id).update(
        {"recording_template_id": None}
    )

    # Delete template
    db.delete(template)
    db.commit()

    return {
        "message": "Recording template deleted successfully",
        "template_id": template_id,
    }


@router.post("/seed-defaults", status_code=201)
async def seed_default_recording_templates(db: Session = Depends(get_db)):
    """
    Seed database with default recording template definitions.

    Creates templates for common recording types if they don't already exist.
    """
    defaults = [
        RecordingTemplateCreate(
            name="General Recording",
            description="Default template for recordings with basic metadata only",
            metadata_schema=[
                MetadataField(name="title", label="Title", field_type="text"),
                MetadataField(name="date", label="Date", field_type="date"),
                MetadataField(name="notes", label="Notes", field_type="textarea"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["title", "date", "notes"],
            ),
        ),
        RecordingTemplateCreate(
            name="Meeting Minutes",
            description="Team meetings, standups, planning sessions",
            metadata_schema=[
                MetadataField(name="meeting_date", label="Meeting Date", field_type="date", required=True),
                MetadataField(name="attendees", label="Attendees", field_type="textarea", required=True),
                MetadataField(name="agenda_items", label="Agenda Items", field_type="textarea"),
                MetadataField(name="action_items", label="Action Items", field_type="textarea"),
                MetadataField(name="decisions_made", label="Decisions Made", field_type="textarea"),
                MetadataField(name="next_meeting_date", label="Next Meeting Date", field_type="date"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["meeting_date", "attendees", "agenda_items", "action_items", "decisions_made"],
                header_template="Meeting Minutes\nDate: {meeting_date}\n\nAttendees:\n{attendees}",
            ),
        ),
        RecordingTemplateCreate(
            name="Interview",
            description="Job interviews, research interviews, informational interviews",
            metadata_schema=[
                MetadataField(name="interviewer", label="Interviewer", field_type="text", required=True),
                MetadataField(name="interviewee", label="Interviewee", field_type="text", required=True),
                MetadataField(name="position_role", label="Position/Role", field_type="text"),
                MetadataField(name="interview_type", label="Interview Type", field_type="select",
                            options=["Phone", "Video", "In-Person"]),
                MetadataField(name="key_topics", label="Key Topics", field_type="textarea"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["interviewer", "interviewee", "position_role", "interview_type", "key_topics"],
                header_template="Interview: {interviewee}\nInterviewer: {interviewer}\nPosition: {position_role}",
            ),
        ),
        RecordingTemplateCreate(
            name="Lecture/Training",
            description="Educational lectures, training sessions, workshops",
            metadata_schema=[
                MetadataField(name="instructor", label="Instructor", field_type="text", required=True),
                MetadataField(name="course_code", label="Course Code", field_type="text"),
                MetadataField(name="session_number", label="Session Number", field_type="number"),
                MetadataField(name="topic", label="Topic", field_type="text", required=True),
                MetadataField(name="learning_objectives", label="Learning Objectives", field_type="textarea"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["instructor", "course_code", "session_number", "topic", "learning_objectives"],
                header_template="Lecture: {topic}\nInstructor: {instructor}\nCourse: {course_code}",
            ),
        ),
        RecordingTemplateCreate(
            name="Deposition",
            description="Legal depositions with witness examination",
            metadata_schema=[
                MetadataField(name="deponent_name", label="Deponent Name", field_type="text", required=True),
                MetadataField(name="case_reference", label="Case Reference", field_type="text", required=True),
                MetadataField(name="attorney_present", label="Attorney Present", field_type="text"),
                MetadataField(name="court_reporter", label="Court Reporter", field_type="text"),
                MetadataField(name="examination_type", label="Examination Type", field_type="select",
                            options=["Direct", "Cross", "Redirect", "Recross"]),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["deponent_name", "case_reference", "attorney_present", "examination_type"],
                header_template="Deposition of {deponent_name}\nCase: {case_reference}\nAttorney: {attorney_present}",
            ),
        ),
        RecordingTemplateCreate(
            name="Patient Consultation",
            description="Medical consultations and patient visits",
            metadata_schema=[
                MetadataField(name="appointment_type", label="Appointment Type", field_type="select",
                            options=["Initial", "Follow-up", "Emergency", "Telehealth"]),
                MetadataField(name="chief_complaint", label="Chief Complaint", field_type="textarea", required=True),
                MetadataField(name="duration_minutes", label="Duration (minutes)", field_type="number"),
                MetadataField(name="follow_up_needed", label="Follow-up Needed", field_type="select",
                            options=["Yes", "No", "As Needed"]),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["appointment_type", "chief_complaint", "duration_minutes", "follow_up_needed"],
            ),
        ),
        RecordingTemplateCreate(
            name="Sales Call",
            description="Sales calls and client prospecting",
            metadata_schema=[
                MetadataField(name="prospect_name", label="Prospect Name", field_type="text", required=True),
                MetadataField(name="company", label="Company", field_type="text"),
                MetadataField(name="deal_stage", label="Deal Stage", field_type="select",
                            options=["Discovery", "Demo", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]),
                MetadataField(name="products_discussed", label="Products Discussed", field_type="textarea"),
                MetadataField(name="objections_raised", label="Objections Raised", field_type="textarea"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["prospect_name", "company", "deal_stage", "products_discussed"],
                header_template="Sales Call: {prospect_name} ({company})\nStage: {deal_stage}",
            ),
        ),
    ]

    created = []
    skipped = []

    for default in defaults:
        # Check if already exists
        existing = db.query(RecordingTemplateDB).filter(RecordingTemplateDB.name == default.name).first()
        if existing:
            skipped.append(default.name)
            continue

        # Create
        template_id = str(uuid4())
        metadata_schema_json = json.dumps([field.model_dump() for field in default.metadata_schema])
        export_config_json = json.dumps(default.export_template_config.model_dump())

        template_db = RecordingTemplateDB(
            id=template_id,
            name=default.name,
            description=default.description,
            metadata_schema=metadata_schema_json,
            export_template_config=export_config_json,
        )

        db.add(template_db)
        created.append(default.name)

    db.commit()

    return {
        "message": "Default recording templates seeded",
        "created": created,
        "skipped": skipped,
    }
