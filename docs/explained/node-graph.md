# Node graph

The Nodes workspace is modelled on Blender's texture node editor: typed sockets, inline defaults on
unconnected inputs, and a render root that decides what reaches the node preview.

The workspace keeps a live 16:9 viewport at the top of the right sidebar, above the Inspector.
Selecting an image-processing node previews that node's branch immediately, while selecting a
value-only node leaves the active Viewer or Composite result visible. The Library stays on the left
and the graph keeps the full centre workspace.

## Sockets carry the parameters

There is no separate properties panel. Every parameter of a node is an **input socket** with an
inline default drawn on the node body — exactly like Blender, where an unconnected input shows a
widget and a connected one shows nothing but the link. Link a Math node into a Blur's *Radius* and
the number field disappears; the value now comes from upstream.

Two socket types, colour-coded the way Blender codes its own:

| Type | Colour | Carries |
|---|---|---|
| Image | yellow `#d9b45a` | a stream of pixels |
| Value | grey `#9a9a9a` | a single number |

A link is only allowed between sockets of the **same type**. An input takes one link — connecting a
second replaces the first — while an output feeds as many inputs as you like. Dragging away from a
linked input detaches the noodle and hands it back to the cursor. Cycles are refused outright: they
would leave evaluation order undefined.

## Node set

| Category | Nodes |
|---|---|
| Input | Image, Text, 3D Scene — each binds to a timeline layer through a picker on the node |
| Distort | Translate, Rotate, Scale — separate nodes, as Blender splits them |
| Filter | Blur, Glow, Vignette |
| Color | Invert, Bright / Contrast, Color Matrix, Hue / Saturation |
| Composite | Mix, Stack |
| Converter | Math, RGB to BW |
| Output | Composite, Viewer |

**Mix** is Blender's Mix: `Fac`, `A`, `B`, and a blend mode (Over, Add, Multiply, Screen, Overlay,
Difference, Lighten, Darken). Chaining them is how more than two streams combine, and it is what the
starting graph uses.

**Stack** is a deliberate addition, not a Blender node: one dynamic input list that piles any number
of streams bottom-up, for graphs where a long Mix chain would be noise. It keeps exactly one free
input at the bottom, growing and shrinking as links come and go. Nothing builds it by default.

**Glow** is a bloom, so it emits two passes: the sharp image, plus a blurred and brightened copy
drawn additively over it. With no intermediate render targets, that second copy has to be a pass of
its own rather than a filter.

## The starting graph comes from the layers

A layer already carries its own effect list — `Glow` on the title, `Color Matrix` and `Vignette` on
the grade, `Brightness / Contrast` on the footage. The starting graph turns each of those into a
real node in that layer's chain, with the defaults the layer inspector shows, then combines the
branches through chained Mixes into Composite:

```
Ridge Expedition ──▶ Bright / Contrast ─┐
Aurora Mark ────────────────────────────┼─▶ Mix ─▶ Mix ─▶ Mix ─▶ Mix ─▶ Composite
Aurora 3D Study ────────────────────────┤
BEYOND THE HORIZON ─▶ Glow ─────────────┤
Cinematic Grade ─▶ Color Matrix ─▶ Vignette
```

So the graph opens describing the composite the project actually means, not a bare list of sources
funnelled into one box.

**Math** outputs a Value, so it can drive any value socket in the graph — a blur radius, a mix
factor, a translate offset.

Muting a node (**M**) turns it into a wire: its first image input passes straight through.

## Evaluation

`evaluateNodeGraph` walks upstream from the render root and returns the passes to draw, background
first. The render root is the **Composite** node, unless a **Viewer** node is activated with the eye
button on its header — then the Nodes viewport shows that branch instead, which is what Blender's
Viewer is for. The Motion viewport keeps rendering the timeline layer stack independently.

Value sockets resolve first: a linked value socket evaluates its upstream Math chain, an unlinked one
returns the inline default shown on the node.

A source node bound to no layer contributes nothing. A root that reaches nothing renders an empty
frame — that is a real answer, not a reason to ignore the graph. Only a project with no render root
at all falls back to drawing the raw layer stack.

## The honest limit

The renderer draws passes straight to the frame buffer with no intermediate render targets. A Mix is
therefore expressed as *"draw A, then draw B over it with this blend mode and Fac as its alpha"*.
That matches Blender's result whenever A is what is already on the canvas — true for every chain
that ends at the root — but it is not per-branch isolation: a Mix cannot composite two branches
privately and hand the result on unchanged. Aurora-owned render targets are the prerequisite, and
they are a separate piece of work.

For the same reason a 3D pass takes opacity plus frame-space vignette from the graph: blur, offsets
and colour still operate on Pixi containers, while the 3D scene renders directly into the frame
buffer.

Colour nodes fold into one `ColorMatrixFilter`, so a chain of them still costs a single filter pass.

## Starting graph and persistence

The starting graph mirrors the layer stack exactly — one bound source per visible layer, piled
bottom-first into a Stack, into Composite — so switching the renderer onto the graph changes nothing
on screen until the graph is rewired.

Nodes and connections live in their own IndexedDB tables. A graph saved before typed sockets existed
cannot be repaired field by field, so it is rebuilt from the current layer stack; links naming a node
or socket that no longer exists are dropped on load.

## Sources

- [Texture Nodes — Blender Manual](https://docs.blender.org/manual/en/latest/editors/texture_node/index.html)
- [Sockets — Blender node data types, colours and implicit conversions](https://wannesmalfait.github.io/Blender-shaders/mnode/sockets.html)
- [Node Parts — Blender Manual](https://docs.blender.org/manual/en/latest/interface/controls/nodes/parts.html)
