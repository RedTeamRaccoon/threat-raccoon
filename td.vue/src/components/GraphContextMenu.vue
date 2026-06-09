<template>
    <ul
        v-if="visible"
        class="td-context-menu"
        :style="{ top: y + 'px', left: x + 'px' }"
        @contextmenu.prevent
    >
        <li class="td-context-menu-item" @click="select('toFront')">
            {{ $t('threatmodel.buttons.zorder.toFront') }}
        </li>
        <li class="td-context-menu-item" @click="select('forward')">
            {{ $t('threatmodel.buttons.zorder.forward') }}
        </li>
        <li class="td-context-menu-item" @click="select('backward')">
            {{ $t('threatmodel.buttons.zorder.backward') }}
        </li>
        <li class="td-context-menu-item" @click="select('toBack')">
            {{ $t('threatmodel.buttons.zorder.toBack') }}
        </li>
    </ul>
</template>

<style lang="scss" scoped>
.td-context-menu {
    position: fixed;
    z-index: 1050;
    min-width: 170px;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--td-surface, #ffffff);
    color: var(--td-text, #333333);
    border: 1px solid var(--td-border, #dee2e6);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    font-size: 14px;
}

.td-context-menu-item {
    padding: 6px 16px;
    cursor: pointer;
    white-space: nowrap;
}

.td-context-menu-item:hover {
    background: var(--td-surface-raised, #f5f5f5);
}
</style>

<script>
export default {
    name: 'TdGraphContextMenu',
    props: {
        visible: {
            type: Boolean,
            default: false
        },
        x: {
            type: Number,
            default: 0
        },
        y: {
            type: Number,
            default: 0
        }
    },
    methods: {
        select(action) {
            this.$emit('action', action);
        }
    }
};
</script>
