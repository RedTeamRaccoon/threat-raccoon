<template>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div
        v-if="hasText"
        class="td-markdown"
        v-html="rendered"
    ></div>
</template>

<script>
import MarkdownIt from 'markdown-it';

// v-html is safe in this component: the markdown-it instance below is
// configured with html:false, so any raw HTML in the user-authored text is
// escaped by markdown-it itself and never reaches the DOM as live markup. The
// v-html input is therefore only trusted markdown-it output, never unsanitised
// user input.
//
// Create the markdown-it instance once at module load, not per render.
const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true
});

export default {
    name: 'TdMarkdown',
    props: {
        text: {
            type: String,
            required: false,
            default: ''
        }
    },
    computed: {
        hasText() {
            return typeof this.text === 'string' && this.text.trim().length > 0;
        },
        rendered() {
            if (!this.hasText) {
                return '';
            }
            return md.render(this.text);
        }
    }
};
</script>

<style lang="scss" scoped>
.td-markdown {
    // Sensible compact typography that fits inside cards, report sections and
    // table cells, and prints without huge gaps.

    // remove the leading/trailing margins so the block sits flush in its container
    :deep(*:first-child) {
        margin-top: 0;
    }

    :deep(*:last-child) {
        margin-bottom: 0;
    }

    :deep(p) {
        margin-top: 0;
        margin-bottom: 0.5rem;
    }

    :deep(h1),
    :deep(h2),
    :deep(h3),
    :deep(h4),
    :deep(h5),
    :deep(h6) {
        margin-top: 0.6rem;
        margin-bottom: 0.4rem;
        font-weight: 600;
        line-height: 1.2;
        page-break-after: avoid;
    }

    :deep(h1) { font-size: 1.5rem; }
    :deep(h2) { font-size: 1.3rem; }
    :deep(h3) { font-size: 1.15rem; }
    :deep(h4) { font-size: 1rem; }
    :deep(h5) { font-size: 0.9rem; }
    :deep(h6) { font-size: 0.85rem; }

    :deep(ul),
    :deep(ol) {
        margin-top: 0;
        margin-bottom: 0.5rem;
        padding-left: 1.4rem;
    }

    :deep(li) {
        margin-bottom: 0.15rem;
    }

    :deep(blockquote) {
        margin: 0.5rem 0;
        padding: 0.25rem 0.75rem;
        border-left: 3px solid #ccc;
        color: #555;
    }

    :deep(hr) {
        margin: 0.6rem 0;
        border: 0;
        border-top: 1px solid #ddd;
    }

    :deep(code) {
        padding: 0.1rem 0.3rem;
        font-size: 0.85em;
        background-color: #f5f5f5;
        border-radius: 3px;
    }

    :deep(pre) {
        margin: 0.5rem 0;
        padding: 0.5rem 0.75rem;
        font-size: 0.85em;
        background-color: #f5f5f5;
        border-radius: 3px;
        overflow-x: auto;

        code {
            padding: 0;
            background-color: transparent;
        }
    }

    :deep(table) {
        margin-bottom: 0.5rem;
        border-collapse: collapse;
        // keep small tables together when printing
        page-break-inside: avoid;

        th,
        td {
            padding: 0.2rem 0.4rem;
            border: 1px solid #dee2e6;
            text-align: left;
        }

        thead th {
            border-bottom: 2px solid #dee2e6;
            font-weight: 600;
        }
    }

    :deep(img) {
        max-width: 100%;
    }
}
</style>
