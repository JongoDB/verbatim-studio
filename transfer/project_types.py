"""Project Type / Template management endpoints."""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from uuid import uuid4
import json

from persistence import get_db, ProjectTypeDB
from domain import ProjectType, ProjectTypeCreate, ProjectTypeUpdate

router = APIRouter()


@router.post("", response_model=ProjectType, status_code=201)
async def create_project_type(project_type: ProjectTypeCreate, db: Session = Depends(get_db)):
    """
    Create a new project type template.

    Project types define:
    - Custom metadata fields for projects of this type
    - Export template configurations
    - Workflow patterns

    Examples: "Legal Case", "Meeting Minutes", "Interview", "Podcast Episode"
    """
    project_type_id = str(uuid4())

    # Serialize nested models to JSON
    metadata_schema_json = json.dumps([field.model_dump() for field in project_type.metadata_schema])
    export_config_json = json.dumps(project_type.export_template_config.model_dump())

    # Create database record
    project_type_db = ProjectTypeDB(
        id=project_type_id,
        name=project_type.name,
        description=project_type.description,
        metadata_schema=metadata_schema_json,
        export_template_config=export_config_json,
    )

    try:
        db.add(project_type_db)
        db.commit()
        db.refresh(project_type_db)
    except Exception as e:
        db.rollback()
        if "UNIQUE constraint failed" in str(e):
            raise HTTPException(status_code=400, detail=f"Project type '{project_type.name}' already exists")
        raise HTTPException(status_code=500, detail=str(e))

    # Parse back to Pydantic models
    from domain import MetadataField, ExportTemplateConfig

    metadata_schema = [MetadataField(**field) for field in json.loads(project_type_db.metadata_schema)]
    export_config = ExportTemplateConfig(**json.loads(project_type_db.export_template_config))

    return ProjectType(
        id=project_type_db.id,
        name=project_type_db.name,
        description=project_type_db.description,
        metadata_schema=metadata_schema,
        export_template_config=export_config,
        created_at=project_type_db.created_at,
        updated_at=project_type_db.updated_at,
    )


@router.get("", response_model=list[ProjectType])
async def list_project_types(db: Session = Depends(get_db)):
    """List all project type templates."""
    project_types = db.query(ProjectTypeDB).order_by(ProjectTypeDB.name).all()

    from domain import MetadataField, ExportTemplateConfig

    return [
        ProjectType(
            id=pt.id,
            name=pt.name,
            description=pt.description,
            metadata_schema=[MetadataField(**field) for field in json.loads(pt.metadata_schema)],
            export_template_config=ExportTemplateConfig(**json.loads(pt.export_template_config)),
            created_at=pt.created_at,
            updated_at=pt.updated_at,
        )
        for pt in project_types
    ]


@router.get("/{project_type_id}", response_model=ProjectType)
async def get_project_type(project_type_id: str, db: Session = Depends(get_db)):
    """Get a specific project type by ID."""
    project_type = db.query(ProjectTypeDB).filter(ProjectTypeDB.id == project_type_id).first()

    if not project_type:
        raise HTTPException(status_code=404, detail="Project type not found")

    from domain import MetadataField, ExportTemplateConfig

    metadata_schema = [MetadataField(**field) for field in json.loads(project_type.metadata_schema)]
    export_config = ExportTemplateConfig(**json.loads(project_type.export_template_config))

    return ProjectType(
        id=project_type.id,
        name=project_type.name,
        description=project_type.description,
        metadata_schema=metadata_schema,
        export_template_config=export_config,
        created_at=project_type.created_at,
        updated_at=project_type.updated_at,
    )


@router.put("/{project_type_id}", response_model=ProjectType)
async def update_project_type(
    project_type_id: str, update: ProjectTypeUpdate, db: Session = Depends(get_db)
):
    """Update a project type template."""
    project_type = db.query(ProjectTypeDB).filter(ProjectTypeDB.id == project_type_id).first()

    if not project_type:
        raise HTTPException(status_code=404, detail="Project type not found")

    # Update fields
    if update.name is not None:
        project_type.name = update.name

    if update.description is not None:
        project_type.description = update.description

    if update.metadata_schema is not None:
        metadata_schema_json = json.dumps([field.model_dump() for field in update.metadata_schema])
        project_type.metadata_schema = metadata_schema_json

    if update.export_template_config is not None:
        export_config_json = json.dumps(update.export_template_config.model_dump())
        project_type.export_template_config = export_config_json

    from datetime import datetime
    project_type.updated_at = datetime.utcnow()

    try:
        db.commit()
        db.refresh(project_type)
    except Exception as e:
        db.rollback()
        if "UNIQUE constraint failed" in str(e):
            raise HTTPException(status_code=400, detail=f"Project type name '{update.name}' already exists")
        raise HTTPException(status_code=500, detail=str(e))

    from domain import MetadataField, ExportTemplateConfig

    metadata_schema = [MetadataField(**field) for field in json.loads(project_type.metadata_schema)]
    export_config = ExportTemplateConfig(**json.loads(project_type.export_template_config))

    return ProjectType(
        id=project_type.id,
        name=project_type.name,
        description=project_type.description,
        metadata_schema=metadata_schema,
        export_template_config=export_config,
        created_at=project_type.created_at,
        updated_at=project_type.updated_at,
    )


@router.delete("/{project_type_id}")
async def delete_project_type(project_type_id: str, db: Session = Depends(get_db)):
    """
    Delete a project type template.

    Note: Projects using this type will have their project_type_id set to null.
    """
    project_type = db.query(ProjectTypeDB).filter(ProjectTypeDB.id == project_type_id).first()

    if not project_type:
        raise HTTPException(status_code=404, detail="Project type not found")

    # Unlink projects from this type
    from persistence import ProjectDB
    db.query(ProjectDB).filter(ProjectDB.project_type_id == project_type_id).update(
        {"project_type_id": None}
    )

    # Delete project type
    db.delete(project_type)
    db.commit()

    return {
        "message": "Project type deleted successfully",
        "project_type_id": project_type_id,
    }


@router.post("/seed-defaults", status_code=201)
async def seed_default_project_types(db: Session = Depends(get_db)):
    """
    Seed database with default project type templates.

    Creates templates for common use cases if they don't already exist.
    Includes comprehensive templates for legal, healthcare, research, and business scenarios.
    """
    from domain import MetadataField, ExportTemplateConfig

    defaults = [
        ProjectTypeCreate(
            name="Legal Case",
            description="Legal matter or case with parties, court info, and matter details",
            metadata_schema=[
                MetadataField(name="case_number", label="Case Number", field_type="text", required=True),
                MetadataField(name="plaintiff", label="Plaintiff", field_type="text"),
                MetadataField(name="defendant", label="Defendant", field_type="text"),
                MetadataField(name="court", label="Court", field_type="text"),
                MetadataField(name="judge", label="Judge", field_type="text"),
                MetadataField(name="case_type", label="Case Type", field_type="select", options=["Civil", "Criminal", "Family", "Corporate", "Other"]),
                MetadataField(name="filing_date", label="Filing Date", field_type="date"),
                MetadataField(name="status", label="Status", field_type="select", options=["Active", "Pending", "Closed", "Appeal"], default_value="Active"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["case_number", "plaintiff", "defendant", "court", "judge", "case_type"],
                header_template="Case: {case_number}\nCourt: {court}\nParties: {plaintiff} v. {defendant}",
            ),
        ),
        ProjectTypeCreate(
            name="Patient Care",
            description="Healthcare and patient management with medical record tracking",
            metadata_schema=[
                MetadataField(name="patient_id", label="Patient ID", field_type="text", required=True),
                MetadataField(name="mrn", label="Medical Record Number (MRN)", field_type="text"),
                MetadataField(name="dob", label="Date of Birth", field_type="date"),
                MetadataField(name="insurance_info", label="Insurance Information", field_type="textarea"),
                MetadataField(name="diagnosis_codes", label="Diagnosis Codes (ICD-10)", field_type="textarea"),
                MetadataField(name="procedure_codes", label="Procedure Codes (CPT)", field_type="textarea"),
                MetadataField(name="primary_physician", label="Primary Physician", field_type="text"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["patient_id", "mrn", "primary_physician", "diagnosis_codes"],
                header_template="Patient Care Record\nPatient ID: {patient_id}\nMRN: {mrn}\nPhysician: {primary_physician}",
            ),
        ),
        ProjectTypeCreate(
            name="Clinical Trial",
            description="Clinical research trial with protocol and IRB tracking",
            metadata_schema=[
                MetadataField(name="protocol_number", label="Protocol Number", field_type="text", required=True),
                MetadataField(name="irb_approval", label="IRB Approval Number", field_type="text"),
                MetadataField(name="study_phase", label="Study Phase", field_type="select", options=["Phase I", "Phase II", "Phase III", "Phase IV"]),
                MetadataField(name="principal_investigator", label="Principal Investigator", field_type="text", required=True),
                MetadataField(name="enrollment_period", label="Enrollment Period", field_type="text"),
                MetadataField(name="participant_count", label="Participant Count", field_type="number"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["protocol_number", "study_phase", "principal_investigator", "participant_count"],
                header_template="Clinical Trial: {protocol_number}\nPhase: {study_phase}\nPI: {principal_investigator}",
            ),
        ),
        ProjectTypeCreate(
            name="Research Study",
            description="Academic or scientific research project",
            metadata_schema=[
                MetadataField(name="study_id", label="Study ID", field_type="text", required=True),
                MetadataField(name="ethics_approval", label="IRB/Ethics Approval Number", field_type="text"),
                MetadataField(name="research_type", label="Research Type", field_type="select", options=["Qualitative", "Quantitative", "Mixed Methods", "Literature Review"]),
                MetadataField(name="principal_investigator", label="Principal Investigator", field_type="text", required=True),
                MetadataField(name="funding_source", label="Funding Source", field_type="text"),
                MetadataField(name="start_date", label="Start Date", field_type="date"),
                MetadataField(name="end_date", label="End Date", field_type="date"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["study_id", "principal_investigator", "research_type", "funding_source"],
                header_template="Research Study: {study_id}\nPI: {principal_investigator}\nType: {research_type}",
            ),
        ),
        ProjectTypeCreate(
            name="Thesis/Dissertation",
            description="Graduate thesis or dissertation project",
            metadata_schema=[
                MetadataField(name="student_id", label="Student ID", field_type="text", required=True),
                MetadataField(name="degree_program", label="Degree Program", field_type="text", required=True),
                MetadataField(name="advisor", label="Advisor", field_type="text", required=True),
                MetadataField(name="committee_members", label="Committee Members", field_type="textarea"),
                MetadataField(name="defense_date", label="Defense Date", field_type="date"),
                MetadataField(name="approval_status", label="Approval Status", field_type="select", options=["In Progress", "Submitted", "Defended", "Approved", "Revisions Required"], default_value="In Progress"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["student_id", "degree_program", "advisor", "defense_date"],
                header_template="Thesis/Dissertation\nStudent: {student_id}\nProgram: {degree_program}\nAdvisor: {advisor}",
            ),
        ),
        ProjectTypeCreate(
            name="Investigation",
            description="Formal investigation with complainant and respondent tracking",
            metadata_schema=[
                MetadataField(name="case_number", label="Case Number", field_type="text", required=True),
                MetadataField(name="complainant", label="Complainant (Anonymized)", field_type="text"),
                MetadataField(name="respondent", label="Respondent (Anonymized)", field_type="text"),
                MetadataField(name="investigation_type", label="Investigation Type", field_type="select", options=["HR", "Compliance", "Fraud", "Ethics", "Safety", "Other"]),
                MetadataField(name="assigned_investigator", label="Assigned Investigator", field_type="text"),
                MetadataField(name="confidentiality_level", label="Confidentiality Level", field_type="select", options=["Public", "Confidential", "Highly Confidential"], default_value="Confidential"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["case_number", "investigation_type", "assigned_investigator"],
                header_template="Investigation Case: {case_number}\nType: {investigation_type}\nInvestigator: {assigned_investigator}",
                footer_template="CONFIDENTIAL - {confidentiality_level}",
            ),
        ),
        ProjectTypeCreate(
            name="Regulatory Hearing",
            description="Government or regulatory agency hearing",
            metadata_schema=[
                MetadataField(name="docket_number", label="Docket Number", field_type="text", required=True),
                MetadataField(name="regulatory_body", label="Regulatory Body", field_type="text", required=True),
                MetadataField(name="presiding_officer", label="Presiding Officer", field_type="text"),
                MetadataField(name="parties_of_record", label="Parties of Record", field_type="textarea"),
                MetadataField(name="hearing_type", label="Hearing Type", field_type="select", options=["Administrative", "Adjudicatory", "Rulemaking", "Public Comment"]),
                MetadataField(name="public_status", label="Public Status", field_type="select", options=["Public", "Sealed", "Partially Sealed"], default_value="Public"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["docket_number", "regulatory_body", "hearing_type", "presiding_officer"],
                header_template="Regulatory Hearing\nDocket: {docket_number}\nBody: {regulatory_body}\nOfficer: {presiding_officer}",
            ),
        ),
        ProjectTypeCreate(
            name="Legislative Session",
            description="Legislative body meeting or session",
            metadata_schema=[
                MetadataField(name="legislative_body", label="Legislative Body", field_type="text", required=True),
                MetadataField(name="session_number", label="Session Number", field_type="text", required=True),
                MetadataField(name="session_year", label="Session Year", field_type="number", required=True),
                MetadataField(name="jurisdiction", label="Jurisdiction", field_type="text"),
                MetadataField(name="chamber", label="Chamber", field_type="select", options=["Senate", "House", "Assembly", "Joint", "Committee"]),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["legislative_body", "session_number", "session_year", "chamber"],
                header_template="{legislative_body}\nSession {session_number} ({session_year})\nChamber: {chamber}",
            ),
        ),
        ProjectTypeCreate(
            name="Property Transaction",
            description="Real estate transaction with property and agent details",
            metadata_schema=[
                MetadataField(name="property_address", label="Property Address", field_type="textarea", required=True),
                MetadataField(name="mls_number", label="MLS Number", field_type="text"),
                MetadataField(name="transaction_type", label="Transaction Type", field_type="select", options=["Purchase", "Sale", "Lease", "Rental"]),
                MetadataField(name="listing_agent", label="Listing Agent", field_type="text"),
                MetadataField(name="buyer_agent", label="Buyer Agent", field_type="text"),
                MetadataField(name="closing_date_target", label="Target Closing Date", field_type="date"),
            ],
            export_template_config=ExportTemplateConfig(
                include_metadata=True,
                metadata_fields=["property_address", "transaction_type", "listing_agent", "buyer_agent"],
                header_template="Property Transaction\nAddress: {property_address}\nType: {transaction_type}\nListing Agent: {listing_agent}",
            ),
        ),
    ]

    created = []
    skipped = []

    for default in defaults:
        # Check if already exists
        existing = db.query(ProjectTypeDB).filter(ProjectTypeDB.name == default.name).first()
        if existing:
            skipped.append(default.name)
            continue

        # Create
        project_type_id = str(uuid4())
        metadata_schema_json = json.dumps([field.model_dump() for field in default.metadata_schema])
        export_config_json = json.dumps(default.export_template_config.model_dump())

        project_type_db = ProjectTypeDB(
            id=project_type_id,
            name=default.name,
            description=default.description,
            metadata_schema=metadata_schema_json,
            export_template_config=export_config_json,
        )

        db.add(project_type_db)
        created.append(default.name)

    db.commit()

    return {
        "message": "Default project types seeded",
        "created": created,
        "skipped": skipped,
    }
