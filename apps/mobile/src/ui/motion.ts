import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type ViewStyle,
} from 'react-native';
import { tokens } from '@lode/design-tokens';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active) {
        setReduced(value);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

export function useOverlayTransition(open: boolean): Readonly<{
  mounted: boolean;
  backdropStyle: Animated.WithAnimatedValue<ViewStyle>;
  popupStyle: Animated.WithAnimatedValue<ViewStyle>;
}> {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
    const animation = Animated.timing(progress, {
      duration: tokens.motion.duration.panel,
      easing: Easing.bezier(...tokens.motion.easing.standard),
      toValue: open ? 1 : 0,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
      }
    });
    return () => animation.stop();
  }, [open, progress]);

  return {
    mounted,
    backdropStyle: { opacity: progress },
    popupStyle: {
      opacity: progress,
      transform: reduced
        ? undefined
        : [
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.96, 1],
              }),
            },
          ],
    },
  };
}
