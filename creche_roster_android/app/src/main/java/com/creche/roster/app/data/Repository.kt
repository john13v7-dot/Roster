/**
 * Local JSON persistence for [Inputs], using Android's built-in org.json
 * classes so this module needs no extra serialization dependency.
 */
package com.creche.roster.app.data

import android.content.Context
import com.creche.roster.engine.Inputs
import com.creche.roster.engine.Leave
import com.creche.roster.engine.NDAYS
import com.creche.roster.engine.Override
import com.creche.roster.engine.SLOTS
import com.creche.roster.engine.Settings
import com.creche.roster.engine.Shift
import com.creche.roster.engine.Staff
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

private val DATE_FMT: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE
private val TIME_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

private fun dataFile(context: Context): File = File(context.filesDir, "roster_data.json")

object Repository {
    fun load(context: Context): Inputs? {
        val f = dataFile(context)
        if (!f.exists()) return null
        return try {
            fromJson(JSONObject(f.readText()))
        } catch (e: Exception) {
            null
        }
    }

    fun save(context: Context, inputs: Inputs) {
        dataFile(context).writeText(toJson(inputs).toString())
    }

    fun toJson(inputs: Inputs): JSONObject {
        val root = JSONObject()
        root.put("settings", settingsToJson(inputs.settings))
        root.put("staff", JSONArray(inputs.staff.map { staffToJson(it) }))
        root.put("leave", JSONArray(inputs.leave.map { leaveToJson(it) }))
        root.put("overrides", JSONArray(inputs.overrides.map { overrideToJson(it) }))
        root.put("history", historyToJson(inputs.history))
        root.put("lastSlot", JSONObject(inputs.lastSlot))
        return root
    }

    fun fromJson(root: JSONObject): Inputs {
        val settings = settingsFromJson(root.getJSONObject("settings"))
        val staffArr = root.getJSONArray("staff")
        val staff = (0 until staffArr.length()).map { staffFromJson(staffArr.getJSONObject(it)) }
        val leaveArr = root.optJSONArray("leave") ?: JSONArray()
        val leave = (0 until leaveArr.length()).map { leaveFromJson(leaveArr.getJSONObject(it)) }
        val overridesArr = root.optJSONArray("overrides") ?: JSONArray()
        val overrides = (0 until overridesArr.length()).map { overrideFromJson(overridesArr.getJSONObject(it)) }
        val history = if (root.has("history")) historyFromJson(root.getJSONObject("history")) else emptyMap()
        val lastSlot = if (root.has("lastSlot")) lastSlotFromJson(root.getJSONObject("lastSlot")) else emptyMap()
        return Inputs(settings, staff, leave, overrides, history, lastSlot)
    }

    // ---- Settings ----------------------------------------------------
    private fun settingsToJson(s: Settings): JSONObject {
        val obj = JSONObject()
        obj.put("title", s.title)
        obj.put("rosterStart", s.rosterStart.format(DATE_FMT))
        obj.put("weeks", s.weeks)
        obj.put("floors", JSONArray(s.floors))
        val shifts = JSONObject()
        for ((slot, shift) in s.shifts) {
            val sh = JSONObject()
            sh.put("start", shift.start.format(TIME_FMT))
            sh.put("end", shift.end.format(TIME_FMT))
            shifts.put(slot, sh)
        }
        obj.put("shifts", shifts)
        obj.put("minOpen", JSONObject(s.minOpen))
        obj.put("minClose", JSONObject(s.minClose))
        obj.put("breakText", s.breakText)
        obj.put("dayHeaders", s.dayHeaders)
        return obj
    }

    private fun settingsFromJson(obj: JSONObject): Settings {
        val shiftsObj = obj.getJSONObject("shifts")
        val shifts = mutableMapOf<String, Shift>()
        for (slot in SLOTS) {
            val sh = shiftsObj.getJSONObject(slot)
            shifts[slot] = Shift(
                LocalTime.parse(sh.getString("start"), TIME_FMT),
                LocalTime.parse(sh.getString("end"), TIME_FMT),
            )
        }
        val floorsArr = obj.getJSONArray("floors")
        val floors = (0 until floorsArr.length()).map { floorsArr.getString(it) }
        val minOpen = intMapFromJson(obj.getJSONObject("minOpen"))
        val minClose = intMapFromJson(obj.getJSONObject("minClose"))
        return Settings(
            title = obj.getString("title"),
            rosterStart = LocalDate.parse(obj.getString("rosterStart"), DATE_FMT),
            weeks = obj.getInt("weeks"),
            floors = floors,
            shifts = shifts,
            minOpen = minOpen,
            minClose = minClose,
            breakText = obj.optString("breakText", "10 MINS"),
            dayHeaders = obj.optBoolean("dayHeaders", false),
        )
    }

    private fun intMapFromJson(obj: JSONObject): Map<String, Int> {
        val result = mutableMapOf<String, Int>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            result[k] = obj.getInt(k)
        }
        return result
    }

    // ---- Staff ---------------------------------------------------------
    private fun staffToJson(st: Staff): JSONObject {
        val obj = JSONObject()
        obj.put("name", st.name)
        obj.put("floor", st.floor)
        obj.put("role", st.role)
        obj.put("note", st.note)
        obj.put("fixedSlot", st.fixedSlot ?: JSONObject.NULL)
        obj.put("hours", JSONArray(st.hours))
        obj.put("number", st.number)
        return obj
    }

    private fun staffFromJson(obj: JSONObject): Staff {
        val hoursArr = obj.getJSONArray("hours")
        val hours = MutableList(NDAYS) { i -> if (i < hoursArr.length()) hoursArr.getString(i) else "" }
        return Staff(
            name = obj.getString("name"),
            floor = obj.getString("floor"),
            role = obj.getString("role"),
            note = obj.optString("note", ""),
            fixedSlot = if (obj.isNull("fixedSlot")) null else obj.getString("fixedSlot"),
            hours = hours,
            number = obj.optString("number", ""),
        )
    }

    // ---- Leave / Overrides ----------------------------------------------
    private fun leaveToJson(lv: Leave): JSONObject {
        val obj = JSONObject()
        obj.put("name", lv.name)
        obj.put("start", lv.start.format(DATE_FMT))
        obj.put("end", lv.end?.format(DATE_FMT) ?: JSONObject.NULL)
        obj.put("kind", lv.kind)
        return obj
    }

    private fun leaveFromJson(obj: JSONObject): Leave = Leave(
        name = obj.getString("name"),
        start = LocalDate.parse(obj.getString("start"), DATE_FMT),
        end = if (obj.isNull("end")) null else LocalDate.parse(obj.getString("end"), DATE_FMT),
        kind = obj.optString("kind", "Leave"),
    )

    private fun overrideToJson(ov: Override): JSONObject {
        val obj = JSONObject()
        obj.put("name", ov.name)
        obj.put("start", ov.start.format(DATE_FMT))
        obj.put("end", ov.end?.format(DATE_FMT) ?: JSONObject.NULL)
        obj.put("slot", ov.slot ?: JSONObject.NULL)
        obj.put("text", ov.text)
        return obj
    }

    private fun overrideFromJson(obj: JSONObject): Override = Override(
        name = obj.getString("name"),
        start = LocalDate.parse(obj.getString("start"), DATE_FMT),
        end = if (obj.isNull("end")) null else LocalDate.parse(obj.getString("end"), DATE_FMT),
        slot = if (obj.isNull("slot")) null else obj.getString("slot"),
        text = obj.optString("text", ""),
    )

    // ---- History / last slot --------------------------------------------
    private fun historyToJson(history: Map<String, Map<String, Int>>): JSONObject {
        val obj = JSONObject()
        for ((name, counts) in history) obj.put(name, JSONObject(counts))
        return obj
    }

    private fun historyFromJson(obj: JSONObject): Map<String, Map<String, Int>> {
        val result = mutableMapOf<String, Map<String, Int>>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val name = keys.next()
            result[name] = intMapFromJson(obj.getJSONObject(name))
        }
        return result
    }

    private fun lastSlotFromJson(obj: JSONObject): Map<String, String> {
        val result = mutableMapOf<String, String>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            result[k] = obj.getString(k)
        }
        return result
    }
}
