
var width = 800;
var height = 600;
var color = d3.scaleOrdinal(d3.schemeCategory10);

function componentCategory(node) {
    if (node.type == "unresolved") {
        return "Unresolved dependency";
    }
    var attributes = node.resolvedVariantAttributes;
    var category = attributes["org.gradle.component.category"];
    if (category == "library") {
        return "Library";
    }
    if ((category == "platform") || (category == "enforced-platform")) {
        return "Platform";
    }
    return "Unknown";
}

function typeColor(type) {
    if (type == "project") {
        return "#DEFFDB";
    }
    if (type == "unresolved") {
        return "#FF0000";
    }
    return "#DDCCDD";
}

function drawGraph() {
    var project = $("#project option:selected").text();
    var configuration = $("#configuration option:selected").text();

    var fileName = "graphs/" + project + "_" + configuration + ".json";

    console.log("Loading " + fileName);

    d3.json(fileName).then(function(graph) {
        $("#dr_configuration").html("Project " + graph.project + " configuration " + graph.configuration);
        $("#dr_configuration_description").html(graph.description);

        $("#search_submit").click(function (e) {
            var pattern = $("#search_dependency").val();
            if (pattern == "") {
                unfocus();
            } else {
                graph.nodes.forEach(function(n) {
                    if (n.visible && n.name.indexOf(pattern)>=0) {
                        focusAndPopulate(n);
                    }
                });
            }
        });
        $("#show_constraints").change(restart);
        $("#shortest_path").change(restart);
        $("#projects_only").change(restart);
        $("#configuration").change(restart);
        $("#project").change(restart);

        var shortestPathOnly;
        var projectsOnly;
        var showConstraints;
        var nodeToId = {};
        var incomingEdgeCount = {};
        var outgoingEdgeCount = {};

        function computeFilter() {
            var shortestPathOnly = $("#shortest_path").is(':checked');
            var projectsOnly = $("#projects_only").is(':checked');
            var showConstraints = $("#show_constraints").is(':checked');

            graph.nodes.forEach(function (n, i) {
                n.componentCategory = componentCategory(n);
                nodeToId[n.id] = i;
                n.visible = true;
                if (projectsOnly && (n.type != 'project')) {
                    n.visible = false;
                }
            });

            graph.links.forEach(function (l) {
                l.visible = true;
                if (!showConstraints && l.constraint) {
                    l.visible = false;
                }
                var c = incomingEdgeCount[l.target];
                if (c != undefined) {
                    c++;
                } else {
                    c = 1;
                }
                incomingEdgeCount[l.target] = c;

                c = outgoingEdgeCount[l.target];
                if (c != undefined) {
                    c++;
                } else {
                    c = 1;
                }
                outgoingEdgeCount[l.source] = c;
            })

            if (shortestPathOnly) {
                filterLinksWithDijkstra();
            }
        }
        computeFilter();

        function createSimulation() {
            return d3.forceSimulation(graph.nodes)
                       .force("center", d3.forceCenter(width / 2, height / 2))
                       .force("charge", d3.forceManyBody().strength(function(d, i) { return (incomingEdgeCount[d.id]+outgoingEdgeCount[d.id]) * -600; }))
                       .force("collision", d3.forceCollide(function(d) { return 50; }))
                       .force("link", d3.forceLink(graph.links).id(function(d) {return d.id; }).distance(25).strength(function(d) { return 1/(1+d.depth); }));
        }

        var simulation = createSimulation();

        var graphLayout = simulation.on("tick", ticked);

        function directPredecessors(n) {
            var predecessors = {
                    nodes: new Set(),
                    links: new Set()
                }
            graph.links.forEach(function(d) {
                if (d.visible && d.target == n) {
                    predecessors.nodes.add(d.source.index)
                    predecessors.links.add(d.index)
                }
            })
            return predecessors
        }

        function transitivePredecessors(n) {
            var predecessors = {
                nodes: new Set(),
                links: new Set()
            }
            predecessors.nodes.add(n.index);
            var queue = [n.index]
            while (queue.length>0) {
                var pred = directPredecessors(graph.nodes[queue.pop()])
                pred.nodes.forEach(function (i) {
                    if (!predecessors.nodes.has(i)) {
                        queue.push(i)
                    }
                    predecessors.nodes.add(i)
                })
                pred.links.forEach(function (i) {
                    predecessors.links.add(i)
                })
            }
            return predecessors
        }

        // Computes the shortest path to each node in the graph
        function dijkstra() {
            var queue = new Set();
            var dist = [];
            var prev = [];
            var i = 0;
            graph.nodes.forEach(function(n) {
                dist.push(50000);
                prev.push(-1);
                queue.add(i++);
            });
            dist[0] = 0;
            while (queue.size>0) {
                var cur;
                var minDist = 9999999;
                queue.forEach(function(e) {
                    var d = dist[e];
                    if (d<minDist) {
                        minDist = d;
                        cur = e;
                    }
                });
                queue.delete(cur);
                graph.links.forEach(function(l) {
                    if (!l.constraint) {
                        // we want the shortest dependency path, excluding constraints
                        var src = nodeToId[l.source];
                        var dst = nodeToId[l.target];
                        if (src == cur) {
                            var d = dist[cur] + 1;
                            if (d<dist[dst]) {
                                dist[dst] = d;
                                prev[dst] = cur;
                            }
                        }
                    }
                })
            }
            var result = [];
            for (var idx=0; idx<graph.nodes.length; idx++) {
                var path = [];
                path.push(idx);
                var target = prev[idx];
                while (target>=0) {
                    path.unshift(target);
                    target = prev[target];
                }
                result.push(path);
            }
            return result;
        }

        function filterLinksWithDijkstra() {
            var links = graph.links;
            var shortestPathToEachNode = dijkstra();
            links.forEach(function(l) {
                if (l.visible) {
                    l.visible = false;
                    // for each link, determine if it has to be included in the graph
                    var src = nodeToId[l.source];
                    var target = nodeToId[l.target];
                    shortestPathToEachNode.forEach(function(path) {
                        // a path is a list of nodes
                        for (var i=0; i<path.length-1; i++) {
                            var from = path[i];
                            var to = path[i+1];
                            if (from == src && to == target) {
                                l.visible = true;
                                // go to next link
                                return;
                            }
                        }
                    });
                }
            });
        }

        var svg = d3.select("div#dependency_graph_svg")
           .append("div")
           .classed("svg-container", true) //container class to make it responsive
           .append("svg")
           //responsive SVG needs these 2 attributes and no width and height attr
           .attr("preserveAspectRatio", "xMinYMin meet")
           .attr("viewBox", "0 0 600 400")
           //class to make it responsive
           .classed("svg-content-responsive", true);
        var container = svg.append("g");

        svg.call(
            d3.zoom()
                .scaleExtent([.01, 4])
                .on("zoom", function() { container.attr("transform", d3.event.transform); })
        );

        function linkColor(l) {
            if (l.constraint) {
                return "#aaa"
            }
            return "#000000"
        }

        svg.append('defs').append('marker')
            .attr('id','arrowhead')
            .attr('refX', 6)
            .attr('refY', 2)
            .attr('orient','auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 4)
            .attr('xoverflow','visible')
            .append('svg:path')
            .attr('d', "M 0,0 V 4 L6,2 Z");

        svg.on("click", unfocus);

        var link;
        var nodes;

        function setup() {
            link = container.append("g").attr("class", "links")
            .selectAll("line")
            .data(graph.links)
            .enter()
            .filter(function (l) {
                return l.visible && l.source.visible && l.target.visible;
            })
            .append("path")
            .attr("stroke", linkColor)
            .attr("stroke-width", "1px")
            .attr("fill", "none")
            .style("stroke-dasharray", function (l) {
                if (l.constraint) {
                    return (10, 5)
                }
                return (1,0)
            })
            .attr('marker-end','url(#arrowhead)');

            nodes = container.append("g").attr("class", "nodes")
            .selectAll("g")
            .data(graph.nodes)
            .enter()
            .filter(function (n) {
                return n.visible;
            })
        }

        setup();
        hideDetailsPanel();

        function restart() {
            $("#dependency_graph_svg").html("");
            drawGraph();
        }

        var shift = 5;

        function nodeWidth(d) {
            var width = shift * d.name.length;
            d.boxWidth = width
            return width;
        }

        function nodeHeight(d) {
            var height = 10;
            d.boxHeight = height;
            return height;
        }

        function nodeIcons(d) {
            var icon = "";
            if (d.forced) {
                icon += "\uf6e3"
            }
            if (d.composite) {
                icon += "\uf00a"
            }
            if (d.conflict) {
                icon += "\uf12a"
            }
            if (d.constraint) {
                icon += "\uf358"
            }
            if (d.rule) {
                icon += "\uf085"
            }
            return icon;
        }

        function iconColor(d) {
        var color = "#000000";
                    if (d.forced) {
                        return "#FF0000";
                    }
                    if (d.composite) {
                        return "#AA00FF";
                    }
                    if (d.conflict) {
                        return "#FF0000";
                    }
                    if (d.constraint) {
                        return "#AA00FF";
                    }
                    if (d.rule) {
                        return "#AAAAFF";
                    }
                    return color;
        }

        var outerStroke = nodes
            .append("rect")
            .attr("width", nodeWidth)
            .attr("height", nodeHeight)
            .attr("stroke-width", 2)
            .attr("stroke", function(d) { return color(5); });

        var node = nodes
            .append("rect")
            .attr("width", nodeWidth)
            .attr("height", nodeHeight)
            .attr("fill", function(d) {
                if (d.id == graph.root) {
                    return color(0);
                }
                if (d.componentCategory == "Platform") {
                    return "#EEED9D";
                }
                return typeColor(d.type);
            });

        var label = nodes.append("text")
            .attr("text-anchor", "middle")
            .text(function(d) {
              return d.name ;
            })
            .attr("dx", function(d){
                return (d.name.length*shift/2)
            })
            .attr("dy", "8")
            .attr('font-size',8);

        var icon = nodes.append('text')
                        .attr('width', 10)
                        .attr('height', 10)
                        .attr("style", "font-family: Font\\ Awesome\\ 5\\ Free; font-weight: 900;")
                        .attr('font-size', function(d) { return d.size+'em'} )
                        .attr('fill', iconColor)
                        .text(nodeIcons);


        var focusAndPopulate = function(e) {
           focus(e);
           populateDetails(e);
        }
        label.on("click", focusAndPopulate);

        node.call(
            d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended)
        );

        function ticked() {
            label.call(updateNode);
            node.call(updateNode);
            outerStroke.call(updateNode);
            icon.call(updateNode);
            //link.call(updateLink);
            link.attr("d", positionLink);
        }

        function positionLink(d) {
                var offset = 30;

                var midpoint_x = (d.source.x + d.target.x) / 2;
                var midpoint_y = (d.source.y + d.target.y) / 2;

                var dx = (d.target.x - d.source.x);
                var dy = (d.target.y - d.source.y);

                var normalise = Math.sqrt((dx * dx) + (dy * dy));

                var offSetX = midpoint_x + offset*(dy/normalise);
                var offSetY = midpoint_y - offset*(dx/normalise);

                var headOffsetX = d.target.boxWidth/2;
                var headOffsetY = 0;
                if (d.source.y > d.target.y) {
                    headOffsetY = d.target.boxHeight;
                }

                var tailOffsetX = d.source.boxWidth/2;
                var tailOffsetY = 0;
                if (d.source.y > d.target.y) {
                    tailOffsetY = d.target.boxHeight;
                }

                return "M" + (d.source.x + tailOffsetX) +  "," + (d.source.y + tailOffsetY) +
                    "S" + offSetX + "," + offSetY +
                    " " + (headOffsetX + d.target.x) + "," + (headOffsetY + d.target.y );
            }

        function populateDetails(d) {
            var resolved = d.name;
            var icon = nodeIcons(d);
            if (icon != null) {
                resolved = resolved + "&nbsp;<span class='fa'>" + icon + "</span>";
            }
            var requested = new Set();
            graph.links.forEach(function(l) {
                if (l.target == d) {
                    requested.add(l.requested);
                }
            });
            $("#search_dependency").val(d.name);
            $("#dr_resolved").html(resolved);
            $("#dr_requested").html(Array.from(requested).join("<br>"));
            $("#dr_variant").html(d.resolvedVariantDisplayName);
            var attrs = d.resolvedVariantAttributes;
            $("#dr_component_category").html(d.componentCategory);

            var attributesText = "";
            Object.keys(attrs).forEach(function(key) {
                var value = attrs[key];
                attributesText += "<br>" + key + " = " + value;
            });
            $("#dr_variant_attributes").html(attributesText);
            var selectionReasons = d.selectionReasons;
            var reasons = "<ul>";
            for (var i in selectionReasons) {
                var reason = selectionReasons[i];
                reasons += "<li>" + reason.cause + ":" + reason.reason + "</li>";
            }
            reasons += "</ul>";
            $("#dr_selection_reasons").html(reasons);
        }

        function showDetailsPanel() {
            $("#dependency_graph_details").animate({width:'show'},350);
        }

        function hideDetailsPanel() {
            $("#dependency_graph_details").animate({width:'hide'},350);
        }

        function focus(d) {
            if (d3.event != null) {
                d3.event.stopPropagation();
            }
            showDetailsPanel();
            var predecessors = transitivePredecessors(d);
            var setop = function(o) {
                var focus = predecessors.nodes.has(o.index);
                o.focus = focus;
                return focus ? 1 : 0.1;
            };
            outerStroke.style("opacity", setop);
            node.style("opacity", setop);
            label.style("opacity", setop);
            icon.style("opacity", setop);
            link.style("opacity", function(o) {
                var focus = predecessors.links.has(o.index);
                o.focus = focus;
                return focus ? 1 : 0.1;
            });
            link.style("stroke", function(o) {
                var focus = predecessors.links.has(o.index);
                o.focus = focus;
                return focus ? "#FF0000" : "#000000";
            })
            link.style("stroke-width", function(o) {
                 var focus = predecessors.links.has(o.index);
                 o.focus = focus;
                 return focus ? "3px" : "1px";
            })
        }

        function unfocus() {
           hideDetailsPanel();
           var one = function(e) { e.focus = false; return 1; }
           outerStroke.style("opacity", one);
           node.style("opacity", one);
           label.style("opacity", one);
           icon.style("opacity", one);
           link.style("opacity", one);
           link.style("stroke", "#000000");
           link.style("stroke-width", "1px");
        }

        function fixna(x) {
            if (isFinite(x)) return x;
            return 0;
        }

        function updateNode(node) {
            node.attr("transform", function(d) {
                return "translate(" + fixna(d.x) + "," + fixna(d.y) + ")";
            });
        }

        function dragstarted(d) {
            d3.event.sourceEvent.stopPropagation();
            if (!d3.event.active) graphLayout.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(d) {
            d.fx = d3.event.x;
            d.fy = d3.event.y;
        }

        function dragended(d) {
            if (!d3.event.active) graphLayout.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
    });

}

drawGraph();

