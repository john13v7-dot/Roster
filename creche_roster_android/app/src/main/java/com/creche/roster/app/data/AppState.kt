/**
 * Process-wide app state. A plain singleton (rather than a ViewModel) keeps
 * the dependency list small; Compose state reads still trigger recomposition
 * no matter where the State object lives, and a singleton survives
 * configuration changes (rotation) for free since it isn't tied to the
 * Activity instance.
 *
 * [Inputs] is treated as immutable from the UI's point of view: every change
 * goes through [update], which replaces the whole object via data-class
 * `copy()`. That is what makes Compose's structural-equality state actually
 * notice the change and recompose (reassigning the very same mutated object
 * would not).
 */
package com.creche.roster.app.data

import androidx.compose.runtime.mutableStateOf
import com.creche.roster.engine.InputError
import com.creche.roster.engine.Inputs
import com.creche.roster.engine.Roster
import com.creche.roster.engine.buildRoster

object AppState {
    val inputs = mutableStateOf<Inputs?>(null)
    val roster = mutableStateOf<Roster?>(null)
    val buildProblems = mutableStateOf<List<String>>(emptyList())

    /** Re-runs the engine against the current inputs and stores the result (or the problems). */
    fun rebuild() {
        val inp = inputs.value ?: return
        try {
            roster.value = buildRoster(inp)
            buildProblems.value = emptyList()
        } catch (e: InputError) {
            roster.value = null
            buildProblems.value = e.problems
        }
    }

    /** Replaces the inputs with the result of [change] and re-runs the engine. */
    fun update(change: (Inputs) -> Inputs) {
        val inp = inputs.value ?: return
        inputs.value = change(inp)
        rebuild()
    }
}
