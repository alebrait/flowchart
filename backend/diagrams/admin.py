from django.contrib import admin

from .models import Diagram, Edge, Node


class NodeInline(admin.TabularInline):
    model = Node
    extra = 0


class EdgeInline(admin.TabularInline):
    model = Edge
    extra = 0
    fk_name = "diagram"


@admin.register(Diagram)
class DiagramAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "revision", "updated_at")
    list_filter = ("created_at", "updated_at")
    search_fields = ("title", "owner__username")
    readonly_fields = ("id", "revision", "created_at", "updated_at")
    inlines = (NodeInline, EdgeInline)


@admin.register(Node)
class NodeAdmin(admin.ModelAdmin):
    list_display = ("label", "shape_type", "diagram")
    list_filter = ("shape_type",)
    search_fields = ("label", "diagram__title", "diagram__owner__username")


@admin.register(Edge)
class EdgeAdmin(admin.ModelAdmin):
    list_display = ("label", "source", "target", "diagram")
    search_fields = ("label", "diagram__title", "diagram__owner__username")
