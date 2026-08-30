# Capacitor ProGuard & R8 Optimization Rules
-keep public class * extends com.getcapacitor.Plugin {
    public <methods>;
}
-keep public class com.getcapacitor.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-dontwarn com.getcapacitor.**

