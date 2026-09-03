import type { ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';
import type { ButtonVariant } from '@lode/design-system-catalog';

import { Button } from './button';
import { Text } from './text';
import { useColors, withAlpha } from './theme';
import { useOverlayTransition } from './motion';

export type DialogAction = Readonly<{
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
}>;

export function Dialog({
  actions = [],
  children,
  description,
  onOpenChange,
  open,
  title,
}: Readonly<{
  actions?: readonly DialogAction[];
  children?: ReactNode;
  description?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}>) {
  return (
    <DialogSurface
      actions={actions}
      description={description}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      {children}
    </DialogSurface>
  );
}

export function AlertDialog({
  cancelLabel = 'Cancel',
  confirmLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
}: Readonly<{
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}>) {
  return (
    <DialogSurface
      actions={[
        { label: cancelLabel, variant: 'secondary' },
        { label: confirmLabel, onPress: onConfirm, variant: 'destructive' },
      ]}
      description={description}
      dismissible={false}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    />
  );
}

function DialogSurface({
  actions,
  children,
  description,
  dismissible = true,
  onOpenChange,
  open,
  title,
}: Readonly<{
  actions: readonly DialogAction[];
  children?: ReactNode;
  description?: string;
  dismissible?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}>) {
  const colors = useColors();
  const transition = useOverlayTransition(open);
  return (
    <Modal
      animationType="none"
      onRequestClose={() => {
        if (dismissible) {
          onOpenChange(false);
        }
      }}
      statusBarTranslucent
      transparent
      visible={transition.mounted}
    >
      <View accessibilityViewIsModal style={styles.viewport}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissible ? 'Close dialog' : undefined}
          disabled={!dismissible}
          onPress={() => onOpenChange(false)}
          style={StyleSheet.absoluteFill}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: withAlpha(colors.foreground, 0.36) },
              transition.backdropStyle,
            ]}
          />
        </Pressable>
        <Animated.View
          style={[
            styles.popup,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.foreground,
            },
            transition.popupStyle,
          ]}
        >
          <Text variant="title-small" weight="semibold">
            {title}
          </Text>
          {description === undefined ? null : (
            <Text color="muted-foreground" style={styles.description}>
              {description}
            </Text>
          )}
          {children === undefined ? null : (
            <View style={styles.content}>{children}</View>
          )}
          {actions.length === 0 ? null : (
            <View style={styles.actions}>
              {actions.map(action => (
                <Button
                  key={action.label}
                  onPress={() => {
                    action.onPress?.();
                    onOpenChange(false);
                  }}
                  size="sm"
                  variant={action.variant ?? 'secondary'}
                >
                  {action.label}
                </Button>
              ))}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  viewport: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: tokens.space.lg,
  },
  popup: {
    borderRadius: tokens.radius.lg,
    borderWidth: tokens.stroke.thin,
    elevation: 12,
    maxWidth: tokens.layout.content.reading,
    padding: tokens.space.xl,
    shadowOffset: { height: tokens.space.xs, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: tokens.radius.lg,
    width: '100%',
  },
  description: { marginTop: tokens.space.xs },
  content: { marginTop: tokens.space.lg },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.xs,
    justifyContent: 'flex-end',
    marginTop: tokens.space.xl,
  },
});
