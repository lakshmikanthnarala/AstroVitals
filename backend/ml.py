from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import IsolationForest, RandomForestClassifier


FEATURE_NAMES = (
    "heart_rate",
    "systolic_bp",
    "diastolic_bp",
    "spo2",
    "respiratory_rate",
    "temperature",
    "hrv",
    "sleep_hours",
)

SCENARIO_NAMES = {
    "normal": "Normal physiological profile",
    "elevated_heart_rate": "Elevated heart-rate pattern",
    "low_oxygen": "Low oxygen saturation pattern",
    "blood_pressure_change": "Blood-pressure change pattern",
    "respiratory_distress": "Combined respiratory pattern",
    "thermal_stress": "Elevated temperature pattern",
    "combined_stress": "Combined physiological pattern",
}


def feature_vector(member: dict) -> np.ndarray:
    systolic, diastolic = parse_blood_pressure(member.get("bp"))
    return np.asarray(
        [
            member.get("hr"),
            systolic,
            diastolic,
            member.get("spo2"),
            member.get("rr"),
            member.get("temp"),
            member.get("hrv"),
            member.get("sleepHours", member.get("sleep_hours", 7.0)),
        ],
        dtype=np.float64,
    )


def parse_blood_pressure(value: object) -> tuple[float, float]:
    if not isinstance(value, str):
        raise ValueError("Blood pressure must be a systolic/diastolic string")
    parts = value.strip().split("/")
    if len(parts) != 2:
        raise ValueError("Blood pressure must be a systolic/diastolic string")
    try:
        systolic, diastolic = (float(part) for part in parts)
    except ValueError as error:
        raise ValueError("Blood pressure must contain numeric values") from error
    if not (50 <= systolic <= 300 and 30 <= diastolic <= 200):
        raise ValueError("Blood pressure is outside the accepted input range")
    return systolic, diastolic


def _normal_samples(rng: np.random.Generator, count: int) -> np.ndarray:
    columns = [
        rng.normal(70, 9, count).clip(45, 98),
        rng.normal(118, 9, count).clip(90, 145),
        rng.normal(76, 7, count).clip(55, 95),
        rng.normal(98, 1.4, count).clip(93, 100),
        rng.normal(14, 2.5, count).clip(8, 22),
        rng.normal(36.8, 0.3, count).clip(35.9, 37.7),
        rng.normal(55, 15, count).clip(15, 110),
        rng.normal(7.1, 0.9, count).clip(4, 10),
    ]
    return np.column_stack(columns)


def _training_data(seed: int = 20261114, samples_per_scenario: int = 700) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    normal = _normal_samples(rng, samples_per_scenario)

    def samples(
        heart_rate: tuple[float, float],
        systolic: tuple[float, float],
        diastolic: tuple[float, float],
        spo2: tuple[float, float],
        respiratory_rate: tuple[float, float],
        temperature: tuple[float, float],
        hrv: tuple[float, float],
    ) -> np.ndarray:
        count = samples_per_scenario
        columns = [
            rng.uniform(*heart_rate, count),
            rng.uniform(*systolic, count),
            rng.uniform(*diastolic, count),
            rng.uniform(*spo2, count),
            rng.uniform(*respiratory_rate, count),
            rng.uniform(*temperature, count),
            rng.uniform(*hrv, count),
            rng.normal(7.0, 1.1, count).clip(3, 10),
        ]
        return np.column_stack(columns)

    scenarios = {
        "elevated_heart_rate": samples((100, 160), (95, 145), (58, 95), (95, 100), (12, 24), (36.0, 37.5), (18, 75)),
        "low_oxygen": samples((75, 120), (95, 145), (58, 95), (82, 94.5), (14, 26), (36.0, 38.0), (15, 75)),
        "blood_pressure_change": samples((55, 115), (82, 102), (45, 68), (94, 100), (10, 22), (36.0, 37.5), (18, 85)),
        "respiratory_distress": samples((100, 175), (85, 145), (48, 95), (75, 93), (22, 40), (36.0, 39.5), (8, 48)),
        "thermal_stress": samples((90, 150), (90, 150), (50, 95), (92, 100), (18, 32), (37.5, 41), (8, 50)),
        "combined_stress": samples((130, 205), (70, 100), (38, 65), (70, 90), (25, 45), (37.8, 41.5), (4, 30)),
    }

    all_samples = np.vstack([normal, *scenarios.values()])
    labels = np.concatenate(
        [
            np.full(samples_per_scenario, "normal"),
            *[np.full(samples_per_scenario, label) for label in scenarios],
        ]
    )
    return all_samples, labels, normal


@dataclass
class HealthModels:
    classifier: RandomForestClassifier
    anomaly_detector: IsolationForest
    normal_anomaly_scores: np.ndarray
    classifier_version: str = "random-forest-synthetic-v1"
    anomaly_version: str = "isolation-forest-synthetic-v1"

    @classmethod
    def train(cls) -> HealthModels:
        features, labels, normal = _training_data()
        classifier = RandomForestClassifier(
            n_estimators=160,
            max_depth=14,
            min_samples_leaf=2,
            class_weight="balanced_subsample",
            random_state=20261114,
            n_jobs=1,
        )
        classifier.fit(features, labels)

        anomaly_detector = IsolationForest(
            n_estimators=160,
            contamination=0.02,
            random_state=20261114,
            n_jobs=1,
        )
        anomaly_detector.fit(normal)
        normal_scores = np.sort(anomaly_detector.score_samples(normal))
        normal_scores.setflags(write=False)

        return cls(classifier, anomaly_detector, normal_scores)

    @property
    def training_samples(self) -> int:
        return 700 * len(SCENARIO_NAMES)

    def analyze(self, member: dict) -> dict:
        vector = feature_vector(member).reshape(1, -1)
        probabilities = self.classifier.predict_proba(vector)[0]
        class_index = int(np.argmax(probabilities))
        predicted_label = str(self.classifier.classes_[class_index])
        confidence = float(probabilities[class_index])
        model_score = float(self.anomaly_detector.score_samples(vector)[0])
        anomaly_percentile = float(
            np.searchsorted(self.normal_anomaly_scores, model_score, side="right")
            / self.normal_anomaly_scores.size
        )
        anomaly_score = round((1.0 - anomaly_percentile) * 100, 1)
        anomaly_threshold = float(np.quantile(self.normal_anomaly_scores, 0.02))
        is_anomalous = model_score < anomaly_threshold

        importances = self.classifier.feature_importances_
        top_features = sorted(
            (
                {"feature": FEATURE_NAMES[index], "importance": round(float(importances[index]), 3)}
                for index in range(len(FEATURE_NAMES))
            ),
            key=lambda item: item["importance"],
            reverse=True,
        )[:3]

        return {
            "classifier": {
                "modelName": "Random Forest classifier",
                "modelVersion": self.classifier_version,
                "predictedClass": predicted_label,
                "predictedScenario": SCENARIO_NAMES[predicted_label],
                "confidence": round(confidence * 100, 1),
                "probabilities": {
                    str(label): round(float(probability) * 100, 1)
                    for label, probability in zip(self.classifier.classes_, probabilities, strict=True)
                },
                "globalFeatureImportances": top_features,
            },
            "anomaly": {
                "modelName": "Isolation Forest detector",
                "modelVersion": self.anomaly_version,
                "anomalyScore": anomaly_score,
                "isAnomalous": is_anomalous,
                "referenceFlags": self._deviation_factors(member),
            },
        }

    @staticmethod
    def _deviation_factors(member: dict) -> list[str]:
        systolic, diastolic = parse_blood_pressure(member.get("bp"))
        factors = []
        if member["hr"] > 100 or member["hr"] < 45:
            factors.append("heart-rate deviation")
        if systolic > 145 or systolic < 90 or diastolic > 95 or diastolic < 55:
            factors.append("blood-pressure deviation")
        if member["spo2"] < 94:
            factors.append("oxygen saturation deviation")
        if member["rr"] > 22 or member["rr"] < 8:
            factors.append("respiratory-rate deviation")
        if member["temp"] > 37.5 or member["temp"] < 35.9:
            factors.append("temperature deviation")
        if member["hrv"] < 20:
            factors.append("HRV deviation")
        return factors
