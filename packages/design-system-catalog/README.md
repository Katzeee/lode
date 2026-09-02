# Lode design-system catalog

This package owns the review catalog shared by Desktop and Mobile: its sections, stable page paths, descriptions, and asset-level review states. It does not own platform component implementations. Desktop and Mobile render the same catalog through navigation and controls that are native to their platform.

Atomic Design informs how components are composed and tested, but it is not a second public taxonomy. The catalog exposes one usage-oriented structure: Foundations, Components, Patterns, Templates & pages, and Review.

Layout is a foundation because window classes, grid, gutters, content measures, safe areas, and reflow rules constrain every composition. Concrete product shells remain templates. Breakpoints follow current available width rather than a phone, tablet, or desktop label, so the same contract works for resized desktop windows, Android split screen, and large mobile displays.

The catalog also owns the cross-platform component vocabulary: variants, anatomy, applicable states, responsive behavior, accessibility guarantees, and token contracts. Platform code owns DOM/CSS or React Native rendering. The review pages render those implementations interactively and show the contract beside them, which keeps the catalog from becoming a gallery of lookalikes.
