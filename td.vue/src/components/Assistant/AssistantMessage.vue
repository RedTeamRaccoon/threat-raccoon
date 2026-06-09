<template>
    <div v-if="!isToolResultOnly" class="td-assistant-message" :class="roleClass">
        <div class="td-assistant-role">{{ roleLabel }}</div>
        <div v-if="text" class="td-assistant-text">{{ text }}</div>
        <div v-if="images.length" class="td-assistant-attachments">
            <b-badge
                v-for="(img, idx) in images"
                :key="`img-${idx}`"
                variant="light"
                class="mr-1"
            >
                <font-awesome-icon icon="image" class="mr-1" />{{ $t('assistant.attachment.image') }}
            </b-badge>
        </div>
        <div v-if="toolUses.length" class="td-assistant-tools">
            <b-badge
                v-for="(tool, idx) in toolUses"
                :key="`tool-${idx}`"
                variant="secondary"
                class="mr-1 mt-1"
            >
                <font-awesome-icon icon="cog" class="mr-1" />{{ tool.name }}
            </b-badge>
        </div>
    </div>
</template>

<script>
export default {
    name: 'TdAssistantMessage',
    props: {
        message: {
            type: Object,
            required: true
        }
    },
    computed: {
        blocks() {
            return Array.isArray(this.message.content)
                ? this.message.content
                : [{ type: 'text', text: String(this.message.content || '') }];
        },
        isToolResultOnly() {
            return this.blocks.length > 0 && this.blocks.every((b) => b.type === 'tool_result');
        },
        text() {
            return this.blocks
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('')
                .trim();
        },
        toolUses() {
            return this.blocks.filter((b) => b.type === 'tool_use');
        },
        images() {
            return this.blocks.filter((b) => b.type === 'image');
        },
        roleClass() {
            return this.message.role === 'user' ? 'td-assistant-user' : 'td-assistant-agent';
        },
        roleLabel() {
            return this.message.role === 'user'
                ? this.$t('assistant.roles.you')
                : this.$t('assistant.roles.assistant');
        }
    }
};
</script>

<style lang="scss" scoped>
.td-assistant-message {
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
}
.td-assistant-user {
    background-color: #eef3fb;
}
.td-assistant-agent {
    background-color: #f6f6f6;
}
.td-assistant-role {
    font-weight: bold;
    font-size: 11px;
    text-transform: uppercase;
    opacity: 0.6;
    margin-bottom: 3px;
}
.td-assistant-tools {
    margin-top: 4px;
}
</style>
