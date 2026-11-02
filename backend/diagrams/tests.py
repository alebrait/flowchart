from uuid import uuid4
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Diagram, Edge, Node

User = get_user_model()


def node_data(node_id=None, label="", shape_type="action"):
    return {
        "id": str(node_id or uuid4()),
        "shape_type": shape_type,
        "label": label,
        "annotation": "",
        "x": 10,
        "y": 20,
        "width": 160,
        "height": 80,
        "visual_properties": {},
        "z_index": 0,
    }


def edge_data(source, target, edge_id=None):
    return {
        "id": str(edge_id or uuid4()),
        "source": source,
        "target": target,
        "source_port": "right",
        "target_port": "left",
        "label": "",
        "color": "#536273",
        "width": 2,
        "line_style": "solid",
        "arrowheads": "end",
        "path_type": "straight",
        "bend_points": [],
    }


def snapshot(nodes=None, edges=None, revision=0):
    return {
        "expected_revision": revision,
        "title": "Process map",
        "description": "",
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": nodes or [],
        "edges": edges or [],
    }


class DiagramApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", password="secure-pass-123")
        self.other_user = User.objects.create_user(username="other", password="secure-pass-123")
        self.diagram = Diagram.objects.create(owner=self.owner, title="Private")
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        self.graph_url = f"/api/diagrams/{self.diagram.pk}/graph/"
        self.detail_url = f"/api/diagrams/{self.diagram.pk}/"

    def test_owner_can_load_and_save_a_blank_graph(self):
        get_response = self.client.get(self.graph_url)
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.data["nodes"], [])
        self.assertEqual(get_response.data["edges"], [])

        response = self.client.put(self.graph_url, snapshot(), format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["revision"], 1)
        self.assertEqual(response.data["diagram"]["title"], "Process map")

    def test_decision_ports_accept_connections_on_cardinal_sides(self):
        action = node_data(label="Inspect")
        decision = node_data(label="Continue?", shape_type="decision")
        edge = edge_data(action["id"], decision["id"])

        response = self.client.put(
            self.graph_url,
            snapshot([action, decision], [edge]),
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["edges"][0]["target_port"], "left")

    def test_snapshot_allows_parallel_connections_and_self_loops(self):
        action = node_data(label="Loop")
        first_edge = edge_data(action["id"], action["id"])
        second_edge = edge_data(action["id"], action["id"])
        second_edge["label"] = "Parallel"

        response = self.client.put(
            self.graph_url,
            snapshot([action], [first_edge, second_edge]),
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.diagram.edges.count(), 2)
        self.assertEqual(self.diagram.edges.filter(source_id=action["id"], target_id=action["id"]).count(), 2)

    def test_unauthenticated_requests_are_rejected(self):
        self.client.force_authenticate(user=None)

        self.assertEqual(self.client.get("/api/diagrams/").status_code, 403)
        self.assertEqual(self.client.get(self.graph_url).status_code, 403)

    def test_ordinary_users_and_staff_cannot_access_another_owners_diagram(self):
        self.client.force_authenticate(user=self.other_user)

        self.assertEqual(self.client.get("/api/diagrams/").data, [])
        self.assertEqual(self.client.get(self.detail_url).status_code, 404)
        self.assertEqual(self.client.get(self.graph_url).status_code, 404)

        staff = User.objects.create_user(
            username="staff",
            password="secure-pass-123",
            is_staff=True,
        )
        self.client.force_authenticate(user=staff)
        self.assertEqual(self.client.get("/api/diagrams/").data, [])
        self.assertEqual(self.client.delete(self.detail_url).status_code, 404)

    def test_superuser_can_read_another_owners_diagram(self):
        administrator = User.objects.create_superuser(
            username="administrator",
            password="secure-pass-123",
        )
        self.client.force_authenticate(user=administrator)

        self.assertEqual(self.client.get(self.detail_url).status_code, 200)
        response = self.client.get(self.graph_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["diagram"]["owner"]["username"], "owner")

    def test_snapshot_rejects_node_and_edge_ids_from_another_diagram(self):
        other_diagram = Diagram.objects.create(owner=self.owner, title="Other")
        foreign_node = Node.objects.create(
            diagram=other_diagram,
            shape_type=Node.Shape.ACTION,
            x=0,
            y=0,
            width=100,
            height=60,
        )
        local_node = node_data(label="Local")
        attempted_foreign_node = node_data(foreign_node.pk, label="Foreign")
        response = self.client.put(
            self.graph_url,
            snapshot([local_node, attempted_foreign_node]),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.diagram.nodes.count(), 0)

    def test_duplicate_remaps_nodes_edges_and_endpoints(self):
        source, target = Node.objects.bulk_create(
            [
                Node(
                    diagram=self.diagram,
                    shape_type=Node.Shape.ACTION,
                    x=0,
                    y=0,
                    width=140,
                    height=80,
                    label="Start",
                ),
                Node(
                    diagram=self.diagram,
                    shape_type=Node.Shape.ACTION,
                    x=240,
                    y=0,
                    width=140,
                    height=80,
                    label="Finish",
                ),
            ]
        )
        edge = Edge.objects.create(
            diagram=self.diagram,
            source=source,
            target=target,
            source_port="right",
            target_port="left",
        )

        response = self.client.post(f"/api/diagrams/{self.diagram.pk}/duplicate/", {}, format="json")

        self.assertEqual(response.status_code, 201)
        duplicate_id = response.data["id"]
        self.assertEqual(response.data["owner"]["username"], "owner")
        duplicate_graph = self.client.get(f"/api/diagrams/{duplicate_id}/graph/").data
        new_node_ids = {node["id"] for node in duplicate_graph["nodes"]}
        self.assertEqual(len(new_node_ids), 2)
        self.assertNotIn(str(source.pk), new_node_ids)
        self.assertNotIn(str(target.pk), new_node_ids)
        self.assertEqual(len(duplicate_graph["edges"]), 1)
        duplicate_edge = duplicate_graph["edges"][0]
        self.assertNotEqual(duplicate_edge["id"], str(edge.pk))
        self.assertIn(duplicate_edge["source"], new_node_ids)
        self.assertIn(duplicate_edge["target"], new_node_ids)

    def test_snapshot_omissions_delete_nodes_and_edges(self):
        source, target = Node.objects.bulk_create(
            [
                Node(
                    diagram=self.diagram,
                    shape_type=Node.Shape.ACTION,
                    x=0,
                    y=0,
                    width=100,
                    height=60,
                ),
                Node(
                    diagram=self.diagram,
                    shape_type=Node.Shape.ACTION,
                    x=200,
                    y=0,
                    width=100,
                    height=60,
                ),
            ]
        )
        Edge.objects.create(
            diagram=self.diagram,
            source=source,
            target=target,
            source_port="right",
            target_port="left",
        )

        response = self.client.put(
            self.graph_url,
            snapshot(nodes=[node_data(source.pk)], revision=0),
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.diagram.nodes.count(), 1)
        self.assertEqual(self.diagram.edges.count(), 0)

    def test_stale_revision_is_rejected_without_overwriting(self):
        first = node_data(label="Saved")
        saved = self.client.put(self.graph_url, snapshot([first]), format="json")
        stale = snapshot([node_data(first["id"], label="Stale")], revision=0)

        response = self.client.put(self.graph_url, stale, format="json")

        self.assertEqual(saved.status_code, 200)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["current_revision"], 1)
        self.assertEqual(self.diagram.nodes.get().label, "Saved")

    def test_database_failure_rolls_back_revision_and_graph_changes(self):
        existing = node_data(label="Original")
        self.assertEqual(
            self.client.put(self.graph_url, snapshot([existing]), format="json").status_code,
            200,
        )
        changed = node_data(existing["id"], label="Must roll back")
        new_node = node_data(label="Create fails")

        with patch.object(Node.objects, "bulk_create", side_effect=IntegrityError("test failure")):
            with self.assertRaises(IntegrityError):
                self.client.put(
                    self.graph_url,
                    snapshot([changed, new_node], revision=1),
                    format="json",
                )

        self.diagram.refresh_from_db()
        self.assertEqual(self.diagram.revision, 1)
        self.assertEqual(self.diagram.nodes.get().label, "Original")


class CsrfApiTests(TestCase):
    def test_registration_login_diagram_create_and_logout_require_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.get("/api/csrf/")
        token = client.cookies["csrftoken"].value
        credentials = {"username": "new-user", "password": "good-secure-pass-123"}

        self.assertEqual(
            client.post("/api/auth/register/", credentials, format="json").status_code,
            403,
        )
        response = client.post(
            "/api/auth/register/",
            credentials,
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 201)

        self.assertEqual(
            client.post("/api/auth/login/", credentials, format="json").status_code,
            403,
        )
        login_response = client.post(
            "/api/auth/login/",
            credentials,
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(login_response.status_code, 200)

        self.assertEqual(
            client.post("/api/diagrams/", {"title": ""}, format="json").status_code,
            403,
        )
        token = client.cookies["csrftoken"].value
        create_response = client.post(
            "/api/diagrams/",
            {"title": ""},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(create_response.status_code, 201)

        self.assertEqual(client.post("/api/auth/logout/", format="json").status_code, 403)
        logout_response = client.post(
            "/api/auth/logout/",
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(logout_response.status_code, 204)
