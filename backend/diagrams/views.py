from uuid import uuid4

from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.http import Http404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Diagram, Edge, Node
from .serializers import (
    DiagramCreateSerializer,
    DiagramUpdateSerializer,
    GraphSnapshotSerializer,
    LoginSerializer,
    RegistrationSerializer,
)
from .services import compare_and_update_diagram


def visible_diagrams(user):
    diagrams = Diagram.objects.select_related("owner")
    if user.is_superuser:
        return diagrams
    return diagrams.filter(owner=user)


def diagram_summary(diagram):
    return {
        "id": str(diagram.id),
        "title": diagram.title,
        "description": diagram.description,
        "owner": {
            "id": diagram.owner_id,
            "username": diagram.owner.get_username(),
        },
        "revision": diagram.revision,
        "created_at": diagram.created_at,
        "updated_at": diagram.updated_at,
    }


def get_visible_diagram(user, diagram_id):
    try:
        return visible_diagrams(user).get(pk=diagram_id)
    except Diagram.DoesNotExist as error:
        raise Http404 from error


def user_data(user):
    return {
        "id": user.pk,
        "username": user.get_username(),
        "is_superuser": user.is_superuser,
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "CSRF cookie set."})


@method_decorator(csrf_protect, name="dispatch")
class RegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(user_data(user), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=serializer.validated_data["username"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            return Response(
                {"detail": "Invalid username or password."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        login(request, user)
        return Response(user_data(user))


class CurrentUserView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"user": None})
        return Response({"user": user_data(request.user)})


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class DiagramListCreateView(APIView):
    def get(self, request):
        diagrams = visible_diagrams(request.user)
        return Response([diagram_summary(item) for item in diagrams])

    def post(self, request):
        serializer = DiagramCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        diagram = serializer.save(owner=request.user)
        return Response(diagram_summary(diagram), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class DiagramDetailView(APIView):
    def get(self, request, diagram_id):
        return Response(diagram_summary(get_visible_diagram(request.user, diagram_id)))

    def patch(self, request, diagram_id):
        diagram = get_visible_diagram(request.user, diagram_id)
        serializer = DiagramUpdateSerializer(diagram, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(diagram_summary(diagram))

    def delete(self, request, diagram_id):
        diagram = get_visible_diagram(request.user, diagram_id)
        diagram.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class DiagramDuplicateView(APIView):
    def post(self, request, diagram_id):
        original = get_visible_diagram(request.user, diagram_id)
        source_nodes = list(original.nodes.all())
        source_edges = list(original.edges.select_related("source", "target"))
        node_ids = {node.pk: uuid4() for node in source_nodes}

        with transaction.atomic():
            duplicate = Diagram.objects.create(
                owner=request.user,
                title=(f"{original.title} copy" if original.title else "Untitled diagram copy")[:200],
                description=original.description,
                viewport=original.viewport,
            )
            Node.objects.bulk_create(
                [
                    Node(
                        id=node_ids[node.pk],
                        diagram=duplicate,
                        shape_type=node.shape_type,
                        label=node.label,
                        annotation=node.annotation,
                        x=node.x,
                        y=node.y,
                        width=node.width,
                        height=node.height,
                        visual_properties=node.visual_properties,
                        z_index=node.z_index,
                    )
                    for node in source_nodes
                ]
            )
            Edge.objects.bulk_create(
                [
                    Edge(
                        diagram=duplicate,
                        source_id=node_ids[edge.source_id],
                        target_id=node_ids[edge.target_id],
                        source_port=edge.source_port,
                        target_port=edge.target_port,
                        label=edge.label,
                        color=edge.color,
                        width=edge.width,
                        line_style=edge.line_style,
                        arrowheads=edge.arrowheads,
                        path_type=edge.path_type,
                        bend_points=edge.bend_points,
                    )
                    for edge in source_edges
                ]
            )
        return Response(diagram_summary(duplicate), status=status.HTTP_201_CREATED)


def graph_node_data(node):
    return {
        "id": str(node.id),
        "shape_type": node.shape_type,
        "label": node.label,
        "annotation": node.annotation,
        "x": node.x,
        "y": node.y,
        "width": node.width,
        "height": node.height,
        "visual_properties": node.visual_properties,
        "z_index": node.z_index,
    }


def graph_edge_data(edge):
    return {
        "id": str(edge.id),
        "source": str(edge.source_id),
        "target": str(edge.target_id),
        "source_port": edge.source_port,
        "target_port": edge.target_port,
        "label": edge.label,
        "color": edge.color,
        "width": edge.width,
        "line_style": edge.line_style,
        "arrowheads": edge.arrowheads,
        "path_type": edge.path_type,
        "bend_points": edge.bend_points,
    }


def graph_data(diagram):
    return {
        "diagram": diagram_summary(diagram),
        "revision": diagram.revision,
        "viewport": diagram.viewport,
        "nodes": [graph_node_data(node) for node in diagram.nodes.all()],
        "edges": [
            graph_edge_data(edge)
            for edge in diagram.edges.select_related("source", "target").all()
        ],
    }


@method_decorator(csrf_protect, name="dispatch")
class DiagramGraphView(APIView):
    def get(self, request, diagram_id):
        return Response(graph_data(get_visible_diagram(request.user, diagram_id)))

    def put(self, request, diagram_id):
        diagram = get_visible_diagram(request.user, diagram_id)
        serializer = GraphSnapshotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        snapshot = serializer.validated_data
        node_ids = [node["id"] for node in snapshot["nodes"]]
        edge_ids = [edge["id"] for edge in snapshot["edges"]]

        if Node.objects.filter(pk__in=node_ids).exclude(diagram=diagram).exists():
            return Response(
                {"nodes": "A node ID already belongs to another diagram."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Edge.objects.filter(pk__in=edge_ids).exclude(diagram=diagram).exists():
            return Response(
                {"edges": "An edge ID already belongs to another diagram."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            updated = compare_and_update_diagram(
                diagram.pk,
                snapshot["expected_revision"],
                snapshot,
            )
            if updated != 1:
                current_revision = Diagram.objects.values_list("revision", flat=True).get(
                    pk=diagram.pk
                )
                return Response(
                    {
                        "detail": "This diagram changed elsewhere. Reload or save a separate copy.",
                        "current_revision": current_revision,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            existing_nodes = {node.pk: node for node in Node.objects.filter(diagram=diagram)}
            nodes_to_create = []
            nodes_to_update = []
            node_fields = [
                "shape_type",
                "label",
                "annotation",
                "x",
                "y",
                "width",
                "height",
                "visual_properties",
                "z_index",
            ]
            for item in snapshot["nodes"]:
                node_data = item.copy()
                node_id = node_data.pop("id")
                node = existing_nodes.get(node_id)
                if node is None:
                    nodes_to_create.append(Node(id=node_id, diagram=diagram, **node_data))
                    continue
                for field in node_fields:
                    setattr(node, field, node_data[field])
                nodes_to_update.append(node)

            if nodes_to_update:
                Node.objects.bulk_update(nodes_to_update, node_fields)
            if nodes_to_create:
                Node.objects.bulk_create(nodes_to_create)

            retained_node_ids = [item["id"] for item in snapshot["nodes"]]
            Node.objects.filter(diagram=diagram).exclude(pk__in=retained_node_ids).delete()

            existing_edges = {edge.pk: edge for edge in Edge.objects.filter(diagram=diagram)}
            edges_to_create = []
            edges_to_update = []
            edge_fields = [
                "source",
                "target",
                "source_port",
                "target_port",
                "label",
                "color",
                "width",
                "line_style",
                "arrowheads",
                "path_type",
                "bend_points",
            ]
            for item in snapshot["edges"]:
                edge_data = item.copy()
                edge_id = edge_data.pop("id")
                edge_data["source_id"] = edge_data.pop("source")
                edge_data["target_id"] = edge_data.pop("target")
                edge = existing_edges.get(edge_id)
                if edge is None:
                    edges_to_create.append(Edge(id=edge_id, diagram=diagram, **edge_data))
                    continue
                for field, value in edge_data.items():
                    setattr(edge, field, value)
                edges_to_update.append(edge)

            if edges_to_update:
                Edge.objects.bulk_update(edges_to_update, edge_fields)
            if edges_to_create:
                Edge.objects.bulk_create(edges_to_create)

            retained_edge_ids = [item["id"] for item in snapshot["edges"]]
            Edge.objects.filter(diagram=diagram).exclude(pk__in=retained_edge_ids).delete()

        diagram.refresh_from_db()
        return Response(graph_data(diagram))
