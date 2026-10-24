package com.pavavak.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeContentPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The front a disguised app shows before the real lock screen. It looks and works like the
 * chosen everyday app; a small "™" next to the title reveals the PIN lock when tapped.
 */
@Composable
fun DecoyScreen(iconId: String, onReveal: () -> Unit, onSecretCode: suspend (String) -> Boolean) {
    when (iconId) {
        "calculator" -> CalculatorDecoy(onReveal, onSecretCode)
        "clock" -> ClockDecoy(onReveal)
        "notes" -> NotesDecoy(onReveal)
        "weather" -> WeatherDecoy(onReveal)
        else -> CalculatorDecoy(onReveal, onSecretCode)
    }
}

/** The hidden entry: a small trademark mark that opens the real app when tapped. */
@Composable
private fun RevealMark(onReveal: () -> Unit, color: Color) {
    Text(
        "™",
        color = color,
        fontSize = 15.sp,
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .clickable(onClick = onReveal)
            .padding(6.dp),
        textAlign = TextAlign.Center,
    )
}

// ── Calculator ───────────────────────────────────────────────────────────────

@Composable
private fun CalculatorDecoy(onReveal: () -> Unit, onSecretCode: suspend (String) -> Boolean) {
    val bg = Color(0xFF17181C)
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val display = remember { mutableStateOf("0") }
    val stored = remember { mutableStateOf<Double?>(null) }
    val op = remember { mutableStateOf<String?>(null) }
    val fresh = remember { mutableStateOf(true) } // next digit starts a new number

    fun current() = display.value.toDoubleOrNull() ?: 0.0
    fun show(v: Double) {
        display.value = if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()
    }
    fun digit(d: String) {
        if (fresh.value || display.value == "0") { display.value = if (d == ".") "0." else d; fresh.value = false }
        else if (!(d == "." && display.value.contains("."))) display.value += d
    }
    fun compute(): Double {
        val a = stored.value ?: return current()
        val b = current()
        return when (op.value) {
            "+" -> a + b; "−" -> a - b; "×" -> a * b; "÷" -> if (b == 0.0) 0.0 else a / b
            else -> b
        }
    }
    fun operator(o: String) {
        if (op.value != null && !fresh.value) { val r = compute(); show(r); stored.value = r }
        else stored.value = current()
        op.value = o; fresh.value = true
    }
    fun equals() {
        if (op.value != null) { show(compute()); stored.value = null; op.value = null; fresh.value = true }
    }
    fun clearAll() { display.value = "0"; stored.value = null; op.value = null; fresh.value = true }

    Column(
        Modifier.fillMaxSize().background(bg).safeContentPadding().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.Bottom,
    ) {
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Calculator", color = Color(0xFF8A8F98), fontSize = 15.sp, fontWeight = FontWeight.Medium)
            RevealMark(onReveal, Color(0xFF3A3D44))
        }
        Spacer(Modifier.weight(1f))
        Text(
            display.value,
            color = Color.White,
            fontSize = 64.sp,
            fontWeight = FontWeight.Light,
            maxLines = 1,
            textAlign = TextAlign.End,
            modifier = Modifier.fillMaxWidth().padding(bottom = 14.dp),
        )
        val rows = listOf(
            listOf("AC" to Color(0xFF3A3D44), "±" to Color(0xFF3A3D44), "%" to Color(0xFF3A3D44), "÷" to Color(0xFFF59E0B)),
            listOf("7" to Color(0xFF2A2C31), "8" to Color(0xFF2A2C31), "9" to Color(0xFF2A2C31), "×" to Color(0xFFF59E0B)),
            listOf("4" to Color(0xFF2A2C31), "5" to Color(0xFF2A2C31), "6" to Color(0xFF2A2C31), "−" to Color(0xFFF59E0B)),
            listOf("1" to Color(0xFF2A2C31), "2" to Color(0xFF2A2C31), "3" to Color(0xFF2A2C31), "+" to Color(0xFFF59E0B)),
            listOf("0" to Color(0xFF2A2C31), "." to Color(0xFF2A2C31), "=" to Color(0xFFF59E0B)),
        )
        for (row in rows) {
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for ((label, c) in row) {
                    val wide = label == "0"
                    Box(
                        Modifier.weight(if (wide) 2.1f else 1f).aspectRatio(if (wide) 2.1f else 1f)
                            .clip(if (wide) RoundedCornerShape(50) else CircleShape)
                            .background(c)
                            .clickable {
                                when (label) {
                                    "AC" -> clearAll()
                                    "±" -> show(current() * -1)
                                    "%" -> show(current() / 100)
                                    "÷", "×", "−", "+" -> operator(label)
                                    "=" ->
                                        // A bare number then "=" may be the secret unlock PIN; a
                                        // real expression just computes. A wrong code does nothing.
                                        if (op.value != null) equals()
                                        else scope.launch { onSecretCode(display.value) }
                                    else -> digit(label)
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(label, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
        Spacer(Modifier.height(6.dp))
    }
}

// ── Clock ────────────────────────────────────────────────────────────────────

@Composable
private fun ClockDecoy(onReveal: () -> Unit) {
    var now by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) { while (true) { now = Date(); delay(1000) } }
    val time = remember { SimpleDateFormat("h:mm", Locale.getDefault()) }
    val secs = remember { SimpleDateFormat("ss", Locale.getDefault()) }
    val ampm = remember { SimpleDateFormat("a", Locale.getDefault()) }
    val date = remember { SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()) }

    Column(
        Modifier.fillMaxSize().background(Color(0xFF0E0F12)).safeContentPadding().padding(20.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Clock", color = Color(0xFF8A8F98), fontSize = 15.sp, fontWeight = FontWeight.Medium)
            RevealMark(onReveal, Color(0xFF33363C))
        }
        Spacer(Modifier.weight(1f))
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(time.format(now), color = Color.White, fontSize = 86.sp, fontWeight = FontWeight.Light)
                Column(Modifier.padding(start = 6.dp, bottom = 16.dp)) {
                    Text(ampm.format(now), color = Color(0xFF6CA0FF), fontSize = 20.sp, fontWeight = FontWeight.Medium)
                    Text(secs.format(now), color = Color(0xFF8A8F98), fontSize = 20.sp)
                }
            }
            Text(date.format(now), color = Color(0xFF8A8F98), fontSize = 17.sp)
        }
        Spacer(Modifier.weight(1.4f))
    }
}

// ── Notes ────────────────────────────────────────────────────────────────────

@Composable
private fun NotesDecoy(onReveal: () -> Unit) {
    var text by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().background(Color(0xFFFFFBEB)).safeContentPadding().padding(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Notes", color = Color(0xFF6B6250), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            RevealMark(onReveal, Color(0xFFD9CEAE))
        }
        Spacer(Modifier.height(14.dp))
        BasicTextField(
            value = text,
            onValueChange = { text = it },
            textStyle = TextStyle(color = Color(0xFF3A3528), fontSize = 17.sp, lineHeight = 26.sp),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(Color(0xFF8A7F5E)),
            modifier = Modifier.fillMaxWidth().weight(1f),
            decorationBox = { inner ->
                if (text.isEmpty()) Text("Note to self…", color = Color(0xFFB9AE8C), fontSize = 17.sp)
                inner()
            },
        )
    }
}

// ── Weather ──────────────────────────────────────────────────────────────────

@Composable
private fun WeatherDecoy(onReveal: () -> Unit) {
    Column(
        Modifier.fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF3A7BD5), Color(0xFF2B5EA8))))
            .safeContentPadding().padding(22.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Weather", color = Color(0xCCFFFFFF), fontSize = 15.sp, fontWeight = FontWeight.Medium)
            RevealMark(onReveal, Color(0x55FFFFFF))
        }
        Spacer(Modifier.height(30.dp))
        Text("My Location", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        Text("Partly Cloudy", color = Color(0xCCFFFFFF), fontSize = 16.sp)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("27°", color = Color.White, fontSize = 82.sp, fontWeight = FontWeight.Thin)
            Icon(Icons.Filled.Cloud, null, tint = Color(0xEEFFFFFF), modifier = Modifier.size(56.dp).padding(start = 10.dp))
        }
        Text("H:31°  L:22°", color = Color(0xCCFFFFFF), fontSize = 15.sp)
        Spacer(Modifier.height(26.dp))
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color(0x33000000)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val days = listOf("Today" to 27, "Tue" to 29, "Wed" to 26, "Thu" to 24, "Fri" to 28)
            for ((d, t) in days) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(d, color = Color.White, fontSize = 16.sp, modifier = Modifier.weight(1f))
                    Icon(if (t >= 28) Icons.Filled.WbSunny else Icons.Filled.Cloud, null,
                        tint = Color(0xEEFFFFFF), modifier = Modifier.size(22.dp))
                    Text("$t°", color = Color.White, fontSize = 16.sp,
                        modifier = Modifier.padding(start = 16.dp))
                }
            }
        }
        Spacer(Modifier.weight(1f))
    }
}
