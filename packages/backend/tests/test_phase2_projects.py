"""Test Phase 2: Projects endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_projects_empty(client: AsyncClient):
    """Test listing projects when none exist."""
    response = await client.get("/api/projects")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_create_project(client: AsyncClient):
    """Test creating a new project."""
    response = await client.post(
        "/api/projects",
        json={"name": "Test Project", "description": "A test project"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Project"
    assert data["description"] == "A test project"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_project_minimal(client: AsyncClient):
    """Test creating a project with only required fields."""
    response = await client.post(
        "/api/projects",
        json={"name": "Minimal Project"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Project"


@pytest.mark.asyncio
async def test_create_project_empty_name(client: AsyncClient):
    """Test creating a project with empty name - may allow empty or fail validation."""
    response = await client.post(
        "/api/projects",
        json={"name": ""},
    )
    # API may accept empty name (201) or reject it (422)
    assert response.status_code in [201, 422]


@pytest.mark.asyncio
async def test_get_project(client: AsyncClient):
    """Test getting a specific project."""
    # First create a project
    create_response = await client.post(
        "/api/projects",
        json={"name": "Get Test Project"},
    )
    project_id = create_response.json()["id"]

    # Then get it
    response = await client.get(f"/api/projects/{project_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Get Test Project"


@pytest.mark.asyncio
async def test_get_project_not_found(client: AsyncClient):
    """Test getting non-existent project returns 404."""
    response = await client.get("/api/projects/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_project(client: AsyncClient):
    """Test updating a project."""
    # First create a project
    create_response = await client.post(
        "/api/projects",
        json={"name": "Original Name"},
    )
    project_id = create_response.json()["id"]

    # Then update it
    response = await client.patch(
        f"/api/projects/{project_id}",
        json={"name": "Updated Name", "description": "New description"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Name"
    assert data["description"] == "New description"


@pytest.mark.asyncio
async def test_delete_project(client: AsyncClient):
    """Test deleting a project."""
    # First create a project
    create_response = await client.post(
        "/api/projects",
        json={"name": "To Delete"},
    )
    project_id = create_response.json()["id"]

    # Then delete it
    response = await client.delete(f"/api/projects/{project_id}")
    assert response.status_code == 200

    # Verify it's gone
    get_response = await client.get(f"/api/projects/{project_id}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_delete_project_not_found(client: AsyncClient):
    """Test deleting non-existent project returns 404."""
    response = await client.delete("/api/projects/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_projects_with_search(client: AsyncClient):
    """Test listing projects with search filter."""
    # Create some projects
    await client.post("/api/projects", json={"name": "Alpha Project"})
    await client.post("/api/projects", json={"name": "Beta Project"})

    # Search
    response = await client.get("/api/projects?search=Alpha")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["name"] == "Alpha Project"
