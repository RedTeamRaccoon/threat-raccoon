// Minimal valid empty v2 model used as a starting point for ops tests.
export function emptyModel() {
    return {
        version: '2.0',
        summary: { title: 'Test Model', owner: 'tester', description: '', id: 0 },
        detail: {
            contributors: [],
            diagrams: [],
            diagramTop: 0,
            reviewer: '',
            threatTop: 0
        }
    };
}
